import { act, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  fontScale: 1,
  width: 327,
  os: "ios",
  dimensionsListeners: new Set<() => void>(),
}));

type HostProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  accessible?: boolean;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  allowFontScaling?: boolean;
  onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
};

vi.mock("react-native", async () => {
  const { createElement, useLayoutEffect, useSyncExternalStore } = await import("react");
  return {
    Platform: {
      get OS() {
        return native.os;
      },
    },
    useWindowDimensions: () => ({
      fontScale: useSyncExternalStore(
        (listener) => {
          native.dimensionsListeners.add(listener);
          return () => native.dimensionsListeners.delete(listener);
        },
        () => native.fontScale,
      ),
      width: native.width + 48,
    }),
    View: (props: HostProps) => {
      useLayoutEffect(() => {
        props.onLayout?.({ nativeEvent: { layout: { width: native.width } } });
      });
      return createElement(
        "div",
        {
          className: props.className,
          style: props.style,
          role: props.accessibilityRole === "image" ? "img" : undefined,
          "aria-label": props.accessibilityLabel,
        },
        props.children,
      );
    },
    Text: (props: HostProps) =>
      createElement(
        "span",
        {
          className: props.className,
          style: {
            ...props.style,
            fontSize:
              props.style?.fontSize === undefined
                ? undefined
                : Number(props.style.fontSize) *
                  (props.allowFontScaling === false ? 1 : native.fontScale),
          },
        },
        props.children,
      ),
    ActivityIndicator: () => createElement("div", { role: "progressbar" }),
    StatusBar: () => null,
  };
});

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { appVariant: "production" } } },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20 }) }));
vi.mock("../features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("uniwind", () => ({ withUniwind: (component: unknown) => component }));
vi.mock("react-native-svg", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { children?: ReactNode; height: number; width: number; viewBox: string }) =>
      createElement(
        "svg",
        { height: props.height, width: props.width, viewBox: props.viewBox },
        props.children,
      ),
    Path: (props: { d: string }) => createElement("path", { d: props.d }),
  };
});

import { LoadingScreen } from "./LoadingScreen";

let root: Root | undefined;
let container: HTMLDivElement;

function renderLoading() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container ??= document.createElement("div");
  root ??= createRoot(container);
  act(() => root!.render(<LoadingScreen message="Connecting to your environment" />));
}

function descriptor() {
  const text = [...container.querySelectorAll("span")].find((node) => node.textContent === "Code");
  if (!text) throw new Error("Missing visible Code descriptor");
  return text;
}

function markHeight() {
  return Number(container.querySelector("svg")?.getAttribute("height"));
}

function changeFontScale(fontScale: number) {
  act(() => {
    native.fontScale = fontScale;
    native.dimensionsListeners.forEach((listener) => listener());
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  native.fontScale = 1;
  native.width = 327;
  native.os = "ios";
  vi.unstubAllGlobals();
});

it.each(["ios", "android"])("enlarges the loading identity proportionally on %s", (os) => {
  native.os = os;
  native.width = 800;
  renderLoading();
  const originalFontSize = Number.parseFloat(descriptor().style.fontSize);
  const originalMarkHeight = markHeight();
  const artwork = [...container.querySelectorAll("path")].map((path) => path.getAttribute("d"));

  changeFontScale(2);

  expect(Number.parseFloat(descriptor().style.fontSize)).toBeCloseTo(originalFontSize * 2);
  expect(markHeight()).toBeCloseTo(originalMarkHeight * 2);
  expect([...container.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(
    artwork,
  );
  expect(container.querySelectorAll('[role="img"][aria-label="INVRT Code"]')).toHaveLength(1);
  expect(container.textContent).toContain("Beta");
  expect(container.textContent).toContain("Connecting to your environment");
  expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
});

it("keeps an enlarged complete loading identity within the measured compact width", () => {
  renderLoading();
  const originalFontSize = Number.parseFloat(descriptor().style.fontSize);
  native.width = 272;
  changeFontScale(3);

  const fontSize = Number.parseFloat(descriptor().style.fontSize);
  expect(fontSize).toBeGreaterThan(originalFontSize);
  expect((fontSize / 0.86) * 9.523).toBeLessThanOrEqual(native.width + 0.01);
  expect(markHeight() / fontSize).toBeCloseTo(1.21 / 0.86);
  expect(container.textContent).toContain("Code");
  expect(container.textContent).toContain("Beta");
});
