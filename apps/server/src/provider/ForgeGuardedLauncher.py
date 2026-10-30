"""Unqualified source proposal: one pinned interpreter, finite pre-exec refusals.

Pre-hook imports are four CPython builtins plus the separately proposed pinned
native _hashlib extension. This is not an OS sandbox
or protection from a malicious interpreter/native TCB. No observation mode exists.
"""
import sys
import marshal
import posix
import _imp


# Explicit additional bootstrap TCB proposal: this exact already-observed native
# extension is parent-verified before spawn and requires separate runtime approval.
import _hashlib


def sha256(data: bytes) -> str:
    return _hashlib.openssl_sha256(data).hexdigest()


def deny(category: str) -> None:
    """Stop, rather than raise an exception that imported code could catch."""
    posix.write(2, ("FORGE_GUARD:" + category + "\n").encode("ascii"))
    posix._exit(78)


def text(value: str) -> str:
    return bytes.fromhex(value).decode("utf-8", "strict")


def launch() -> None:
    if len(sys.argv) < 4:
        deny("contract")
    policy_path, expected_hash = sys.argv[1:3]
    descriptor = -1
    try:
        if not policy_path.startswith("/") or any(part in ("", ".", "..") for part in policy_path.split("/")[1:]):
            deny("policy")
        current = ""
        parts = policy_path.split("/")[1:]
        for index, part in enumerate(parts):
            current += "/" + part
            mode = posix.lstat(current).st_mode & 0o170000
            if mode != (0o100000 if index == len(parts) - 1 else 0o040000):
                deny("policy")
        descriptor = posix.open(policy_path, posix.O_RDONLY | posix.O_NOFOLLOW)
        before = posix.fstat(descriptor)
        if before.st_size > 1048576:
            deny("policy")
        chunks: list[bytes] = []
        length = 0
        while length <= 1048576:
            chunk = posix.read(descriptor, min(65536, 1048577 - length))
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
        data = b"".join(chunks)
        after = posix.fstat(descriptor)
        linked = posix.lstat(policy_path)
        identities = [(item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
                      for item in (before, after, linked)]
        if identities[0] != identities[1] or identities[0] != identities[2] or len(data) > 1048576 or sha256(data) != expected_hash:
            deny("policy")
        policy_text = data.decode("utf-8", "strict")
    except (OSError, UnicodeError):
        deny("policy")
    finally:
        if descriptor != -1:
            posix.close(descriptor)
    rows = [line.split("\t") for line in policy_text.splitlines()]
    if not rows or rows[0] != ["version", "1"]:
        deny("policy")
    files: dict[str, tuple[int, str]] = {}
    modules: dict[str, tuple[str, str, str, str]] = {}
    executions: set[tuple[str, str, str, int, str, str]] = set()
    generated_compilations: set[tuple[str, str]] = set()
    bootstrap: dict[str, tuple[str, str]] = {}
    logical: list[str] = []
    paths: list[str] = []
    router = ""
    cwd = ""
    router_hash = ""
    router_code_hash = ""
    for row in rows[1:]:
        if row[0] == "file" and len(row) == 4:
            path = text(row[1])
            if path in files:
                deny("policy")
            files[path] = (int(row[2]), row[3])
        elif row[0] == "module" and len(row) == 6:
            name = text(row[1])
            if name in modules:
                deny("policy")
            modules[name] = tuple(text(value) for value in row[2:])
        elif row[0] == "exec" and len(row) == 7:
            executions.add((text(row[1]), text(row[2]), text(row[3]), int(row[4]), row[5], row[6]))
        elif row[0] == "generated_compile" and len(row) == 3:
            generated_compilations.add((row[1], row[2]))
        elif row[0] == "bootstrap" and len(row) == 4:
            name = text(row[1])
            if name in bootstrap:
                deny("policy")
            bootstrap[name] = (text(row[2]), text(row[3]))
        elif row[0] == "argv" and len(row) == 2:
            logical.append(text(row[1]))
        elif row[0] == "sys_path" and len(row) == 2:
            paths.append(text(row[1]))
        elif row[0] == "router" and len(row) == 4 and not router:
            router, router_hash, router_code_hash = text(row[1]), row[2], row[3]
        elif row[0] == "cwd" and len(row) == 2 and not cwd:
            cwd = text(row[1])
        else:
            deny("policy")
    if (not router or not cwd or not router_code_hash or "UNQUALIFIED" in policy_text
            or logical != sys.argv[3:] or paths != sys.path or posix.getcwd() != cwd
            or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode):
        deny("contract")
    if set(bootstrap) != set(sys.modules):
        deny("bootstrap")
    for name, (origin, loader) in bootstrap.items():
        module = sys.modules[name]
        spec = getattr(module, "__spec__", None)
        actual_loader = getattr(spec, "loader", None)
        actual_name = (getattr(actual_loader, "__module__", type(actual_loader).__module__) + "."
                       + getattr(actual_loader, "__qualname__", type(actual_loader).__qualname__))
        if str(getattr(spec, "origin", None)) != origin or actual_name != loader:
            deny("bootstrap")
    checking = False
    ready = False
    verified: dict[str, bytes] = {}
    directories = {path.rsplit("/", 1)[0] for path in files}
    # Audit frame access itself raises events. Bounded re-entrancy is only for
    # this trusted guard's own hashing/frame inspection, never for exec/import.
    inspecting = False

    def read_verified(path: str) -> bytes:
        nonlocal checking
        if path not in files or not path.startswith("/") or ".." in path.split("/"):
            deny("origin")
        if path in verified:
            return verified[path]
        expected_size, expected_sha = files[path]
        if expected_size < 0 or expected_size > 16777216:
            deny("origin")
        checking = True
        descriptor = -1
        try:
            current = ""
            parts = path.split("/")[1:]
            for index, part in enumerate(parts):
                current += "/" + part
                stat = posix.lstat(current)
                expected_mode = 0o100000 if index == len(parts) - 1 else 0o040000
                if stat.st_mode & 0o170000 != expected_mode:
                    deny("origin")
            descriptor = posix.open(path, posix.O_RDONLY | posix.O_NOFOLLOW)
            before = posix.fstat(descriptor)
            chunks: list[bytes] = []
            length = 0
            while length <= expected_size:
                chunk = posix.read(descriptor, min(65536, expected_size + 1 - length))
                if not chunk:
                    break
                chunks.append(chunk)
                length += len(chunk)
            result = b"".join(chunks)
            after = posix.fstat(descriptor)
            linked = posix.lstat(path)
            identities = [(item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
                          for item in (before, after, linked)]
            if identities[0] != identities[1] or identities[0] != identities[2]:
                deny("origin")
            if len(result) != expected_size or sha256(result) != expected_sha:
                deny("origin")
            verified[path] = result
            return result
        except OSError:
            deny("io")
        finally:
            if descriptor != -1:
                posix.close(descriptor)
            checking = False
        return b""  # deny exits the process; this is only for static flow analysis.

    def audit(event: str, args: tuple[object, ...]) -> None:
        nonlocal ready, inspecting
        if event == "forge.guard.ready" and not ready:
            ready = True
            return
        if event == "open":
            if checking:
                return
            path, mode, flags = args
            if not isinstance(path, str) or not isinstance(flags, int):
                deny("origin")
            if flags & (posix.O_WRONLY | posix.O_RDWR | posix.O_CREAT | posix.O_TRUNC | posix.O_APPEND):
                deny("write")
            if mode is not None and (not isinstance(mode, str) or any(c in mode for c in "wax+")):
                deny("write")
            read_verified(path)
            return
        if event == "import":
            name, filename = args[:2]
            if not isinstance(name, str) or name not in modules:
                deny("import")
            origin, source, cache, _frozen = modules[name]
            if filename is not None:
                if filename not in (origin, source, cache) or not isinstance(filename, str):
                    deny("origin")
                read_verified(filename)
            if _imp.is_frozen(name):
                if not _frozen or sha256(marshal.dumps(_imp.get_frozen_object(name))) != _frozen:
                    deny("frozen")
            return
        if event == "exec":
            code = args[0]
            inspecting = True
            try:
                frame = sys._getframe(1)
                caller = frame.f_code.co_filename
                caller_sha = sha256(marshal.dumps(frame.f_code))
                data = marshal.dumps(code)
            finally:
                inspecting = False
            identity = (code.co_filename, code.co_name, caller, len(data), sha256(data), caller_sha)
            if identity not in executions:
                deny("exec")
            if code.co_filename == router and sha256(data) != router_code_hash:
                deny("exec")
            return
        if event == "compile":
            source, filename = args
            data = source.encode("utf-8") if isinstance(source, str) else source
            if not isinstance(data, bytes):
                deny("compile")
            if filename == router:
                if sha256(data) != router_hash:
                    deny("compile")
            elif filename == "<string>":
                inspecting = True
                try:
                    caller_sha = sha256(marshal.dumps(sys._getframe(1).f_code))
                finally:
                    inspecting = False
                if (sha256(data), caller_sha) not in generated_compilations:
                    deny("compile")
            elif not isinstance(filename, str) or data != read_verified(filename):
                deny("compile")
            # Even generated compilation cannot execute until its full exec and
            # verified caller fingerprints match the finite independent verdict.
            return
        if event in ("os.listdir", "os.scandir"):
            if not args or args[0] not in directories:
                deny("origin")
            return
        if event == "sys._getframe":
            if inspecting:
                return
            inspecting = True
            try:
                caller_sha = sha256(marshal.dumps(sys._getframe(1).f_code))
            finally:
                inspecting = False
            if not any(identity[5] == caller_sha for identity in executions):
                deny("frame")
            return
        if event == "object.__getattr__" and inspecting and len(args) == 2 and args[1] == "f_code":
            return
        if event in ("marshal.dumps", "marshal.loads"):
            # These operations do not execute Python code. Every resulting exec
            # still meets the full digest/caller check above; no marshal.load path.
            return
        if event == "pathlib.Path.glob":
            if len(args) != 2 or str(args[0]) not in directories or args[1] != "*/SKILL.md":
                deny("origin")
            return
        deny("audit")

    sys.addaudithook(audit)
    sys.audit("forge.guard.ready")
    if not ready:
        deny("hook")
    # No broad <string>, stdlib-path or semantic-equivalence allowance exists.
    # A third argparse record fails the exact exec tuple before its body executes.
    source = read_verified(router)
    if sha256(source) != router_hash:
        deny("origin")
    sys.argv = [router, *logical]
    code = compile(source, router, "exec", dont_inherit=True)
    exec(code, {"__name__": "__main__", "__file__": router, "__package__": None})


if __name__ == "__main__":
    launch()
