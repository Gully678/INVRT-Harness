# Graph Report - contracts-src (2026-10-27)

## Corpus Check

- cluster-only mode — file stats not available

## Summary

- 3031 nodes · 4452 edges · 159 communities (83 shown, 76 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158

## God Nodes (most connected - your core abstractions)

1. `TrimmedNonEmptyString` - 64 edges
2. `ThreadId` - 32 edges
3. `NonNegativeInt` - 27 edges
4. `IsoDateTime` - 25 edges
5. `ProjectId` - 21 edges
6. `ProviderInstanceId` - 20 edges
7. `PositiveInt` - 17 edges
8. `EnvironmentId` - 12 edges
9. `ForwardCompatibleArray()` - 12 edges
10. `ProviderDriverKind` - 12 edges

## Surprising Connections (you probably didn't know these)

- `DesktopPreviewBridge` --references--> `EnvironmentId` [EXTRACTED]
  ipc.ts → baseSchemas.ts
- `DesktopBridge` --references--> `AuthSessionState` [EXTRACTED]
  ipc.ts → auth.ts
- `DesktopBridge` --references--> `ExecutionEnvironmentDescriptor` [EXTRACTED]
  ipc.ts → environment.ts
- `DesktopBridge` --references--> `AdvertisedEndpoint` [EXTRACTED]
  ipc.ts → remoteAccess.ts
- `OrchestrationV2ThreadProjection` --calls--> `ForwardCompatibleUnion()` [EXTRACTED]
  orchestrationV2.ts → baseSchemas.ts

## Import Cycles

- None detected.

## Communities (159 total, 76 thin omitted)

### Community 0 - "Community 0"

Cohesion: 0.01
Nodes (206): ProviderSetupRpcError, PullRequestRpcError, RpcScopeAuthorization, WsAgentSessionsImportRpc, WsAgentSessionsScanRpc, WsAssetsCreateUrlRpc, WsAssetsPersistChatAttachmentsRpc, WsAttachmentsCreateUploadUrlRpc (+198 more)

### Community 1 - "Community 1"

Cohesion: 0.01
Nodes (181): AccountRateLimitsUpdatedPayload, AccountRateLimitsUpdatedType, AccountUpdatedPayload, AccountUpdatedType, AuthStatusPayload, AuthStatusType, CanonicalItemType, CanonicalRequestType (+173 more)

### Community 2 - "Community 2"

Cohesion: 0.01
Nodes (165): CommandNotificationSource, CompactionMessageFields, DedupedBodyMarker, IDLE_COMPACTION_TEXT, IdTableMarker, knownDomainEventTypes, LenientThreadOpens, LIVE_SHELL_STATUSES (+157 more)

### Community 3 - "Community 3"

Cohesion: 0.01
Nodes (139): ConfirmDialogOptions, ConfirmDialogVariant, ContextMenuItem, ContextMenuItemSchema, ContextMenuItemSchemaType, DESKTOP_PREVIEW_RECORDING_CAPTURE_TRIGGER, DesktopAppBranding, DesktopAppBrandingSchema (+131 more)

### Community 4 - "Community 4"

Cohesion: 0.02
Nodes (123): Annotations, ANTIGRAVITY_AUTH_METHODS, AntigravityAuthMethod, AntigravitySettings, AppearanceContrast, APPLE_MODIFIER_LABELS, BackgroundActivityOverrides, BackgroundActivityProfile (+115 more)

### Community 5 - "Community 5"

Cohesion: 0.02
Nodes (116): RelayAccessTokenType, RelayAgentActivityAggregateRow, RelayAgentActivityAggregateState, RelayAgentActivityPublishErrors, RelayAgentActivityPublishProof, RelayAgentActivityPublishProofInvalidError, RelayAgentActivityPublishProofInvalidReason, RelayAgentActivityPublishProofPayload (+108 more)

### Community 6 - "Community 6"

Cohesion: 0.02
Nodes (85): DesktopUpdateCommitInput, EnvironmentTheme, EnvironmentThemeColor, EnvironmentThemeColors, environmentThemeFields, EnvironmentThemeFile, EnvironmentThemeId, KeybindingsInvalidEntryIssue (+77 more)

### Community 7 - "Community 7"

Cohesion: 0.02
Nodes (91): CommentBody, FilePath, PullRequestAction, PullRequestActionInput, PullRequestActivity, PullRequestBaseComparison, PullRequestCapabilities, PullRequestChangeBreakdown (+83 more)

### Community 8 - "Community 8"

Cohesion: 0.04
Nodes (53): GitActionFailedEvent, GitActionFinishedEvent, GitActionHookFinishedEvent, GitActionHookOutputEvent, GitActionHookStartedEvent, GitActionPhaseStartedEvent, GitActionProgressBase, GitActionProgressEvent (+45 more)

### Community 9 - "Community 9"

Cohesion: 0.03
Nodes (72): AuthMcpTokenError, AuthClientSessionRevokeResult, AuthOtherClientSessionsRevokeResult, AuthPairingLinkRevokeResult, connectReachabilityHelpUrl(), EnvironmentAuthenticatedAuth, EnvironmentAuthenticatedPrincipal, EnvironmentAuthenticationErrors (+64 more)

### Community 10 - "Community 10"

Cohesion: 0.03
Nodes (59): RuntimeRequestId, OrchestrationV2RunStatus, OrchestrationV2TurnItemStatus, ORCHESTRATOR_MCP_RUNNING_TASK_NEXT, OrchestratorMcpCapabilitiesInput, OrchestratorMcpCapabilitiesResult, OrchestratorMcpClientRequestId, OrchestratorMcpCreatedThread (+51 more)

### Community 11 - "Community 11"

Cohesion: 0.03
Nodes (57): BROWSER_RECORDING_FRAME_RATES, BrowserRecordingFrameRate, CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS, ConfiguredLocalServerUrls, DEFAULT_BROWSER_RECORDING_FRAME_RATE, DEFAULT_PREVIEW_APPEARANCE, DEFAULT_PREVIEW_ZOOM_FACTOR, DiscoveredLocalServer (+49 more)

### Community 12 - "Community 12"

Cohesion: 0.03
Nodes (70): AuthAccessReadScope, AuthAccessSnapshot, AuthAccessStreamClientRemovedEvent, AuthAccessStreamClientUpsertedEvent, AuthAccessStreamError, AuthAccessStreamEvent, AuthAccessStreamPairingLinkRemovedEvent, AuthAccessStreamPairingLinkUpsertedEvent (+62 more)

### Community 13 - "Community 13"

Cohesion: 0.03
Nodes (59): BoundedUrl, BrowserNavigationTarget, McpCapabilityErrorFields, OptionalTimeoutMs, PointerTargetFields, PREVIEW_AUTOMATION_OPERATIONS, PREVIEW_AUTOMATION_SERVER_OPERATIONS, PREVIEW_AUTOMATION_V1_OPERATIONS (+51 more)

### Community 14 - "Community 14"

Cohesion: 0.04
Nodes (53): DesktopUpdateStateSchema, DesktopElectronProcessMetric, DesktopElectronProcessType, DesktopHostPowerSnapshot, DesktopHostTelemetryHello, DesktopHostTelemetryMessage, DesktopHostTelemetrySnapshot, DesktopTelemetryCancelDesktopUpdate (+45 more)

### Community 15 - "Community 15"

Cohesion: 0.04
Nodes (50): ConfiguredDeviceHostId, DeviceActionInput, DeviceActionType, DeviceAppearance, DeviceCloseInput, DeviceColorFilter, DeviceConfigureInput, DeviceDetail (+42 more)

### Community 16 - "Community 16"

Cohesion: 0.05
Nodes (46): ACP_REGISTRY_MAX_AGENTS, AcpRegistryAcceptUrlAuthInput, AcpRegistryAcceptUrlAuthResult, AcpRegistryAgentId, AcpRegistryConfigurableProvider, AcpRegistryDeleteSessionInput, AcpRegistryDeleteSessionResult, AcpRegistryDisableProviderInput (+38 more)

### Community 17 - "Community 17"

Cohesion: 0.04
Nodes (45): ScheduledTaskId, SecretRef, OrchestrationV2Actor, OrchestrationV2CreationSource, OrchestrationV2ThreadLaunchWorkspaceStrategy, MAX_WEBHOOK_DELIVERY_AGE_MINUTES, MAX_WEBHOOK_FILTERS, ScheduledTask (+37 more)

### Community 18 - "Community 18"

Cohesion: 0.05
Nodes (28): AssetAccessError, AssetAttachmentNotFoundError, AssetCreateUrlInput, AssetCreateUrlResult, AssetImageDimensions, AssetPreviewTypeValidationError, AssetProjectFaviconInspectionError, AssetProjectFaviconNotFoundError (+20 more)

### Community 19 - "Community 19"

Cohesion: 0.05
Nodes (40): Project, ProjectChange, ProjectContentMatch, ProjectContentMatchRange, ProjectCreateNewInput, ProjectCreateNewResult, ProjectEmoji, ProjectEmojiIcon (+32 more)

### Community 20 - "Community 20"

Cohesion: 0.05
Nodes (36): DEFAULT_MAX_TERMINAL_BUFFER_BYTES, TerminalActivityEvent, TerminalAttachInput, TerminalAttachSnapshotEvent, TerminalAttachStreamEvent, TerminalClearedEvent, TerminalClearInput, TerminalClosedEvent (+28 more)

### Community 21 - "Community 21"

Cohesion: 0.06
Nodes (34): ACP_REGISTRY_DRIVER_KIND, ANTIGRAVITY_DEFAULT_MODEL, BooleanProviderOptionDescriptor, canonicalSelectionsToLegacyObject(), CLAUDE_DRIVER_KIND, CODEX_DRIVER_KIND, coerceLegacyOptionsObjectToArray(), CURSOR_DRIVER_KIND (+26 more)

### Community 22 - "Community 22"

Cohesion: 0.07
Nodes (28): CheckpointId, CheckpointRef, CheckpointScopeId, ClientConnectionMethod, ClientDeviceType, ClientOs, ClientWebDeployment, ContextHandoffId (+20 more)

### Community 23 - "Community 23"

Cohesion: 0.06
Nodes (31): attachmentBinding, COMPOSER_CONTEXT_LABEL_MAX_CHARS, COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS, COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS, COMPOSER_CONTEXT_TERMINAL_TEXT_MAX_CHARS, ComposerContextId, ComposerContextKind, ComposerContextReferenceId (+23 more)

### Community 24 - "Community 24"

Cohesion: 0.09
Nodes (22): ChatAttachment, ChatAttachmentId, ChatUnknownAttachment, PastedTextAttachmentSource, PersistChatAttachmentsError, PersistChatAttachmentsInput, PersistChatAttachmentsResult, PROVIDER_SEND_TURN_MAX_FILE_BYTES (+14 more)

### Community 25 - "Community 25"

Cohesion: 0.07
Nodes (25): KeybindingCommand, KeybindingRule, KeybindingsConfig, KeybindingsConfigError, KeybindingShortcut, KeybindingValue, KeybindingWhen, KeybindingWhenNode (+17 more)

### Community 26 - "Community 26"

Cohesion: 0.14
Nodes (13): decodeModelSelection, encodeModelSelection, isProviderDriverKind(), isProviderDriverKindValue, ProviderInstanceConfig, ProviderInstanceConfigMap, ProviderInstanceEnvironment, ProviderInstanceEnvironmentVariable (+5 more)

### Community 27 - "Community 27"

Cohesion: 0.08
Nodes (31): TurnId, ChatFileAttachment, ChatImageAttachment, PROVIDER_SEND_TURN_MAX_ATTACHMENTS, PROVIDER_SEND_TURN_MAX_INPUT_CHARS, ProviderEvent, ProviderEventKind, ProviderInterruptTurnInput (+23 more)

### Community 28 - "Community 28"

Cohesion: 0.08
Nodes (24): ForwardCompatibleOptional(), ByteCount, ChatGptHandoffInput, ChatGptHandoffState, ChatGptImportProfileInput, ChatGptReconnectProfile, ChatGptReconnectProfileInput, ChatGptTransferredProfile (+16 more)

### Community 29 - "Community 29"

Cohesion: 0.08
Nodes (23): GuestMessageId, GUEST_ATTACHMENT_ROUTE, GUEST_COMMAND_OUTPUT_ROUTE, GUEST_ITEM_ROUTE, GUEST_MESSAGE_MAX_ATTACHMENT_BYTES, GUEST_MESSAGE_MAX_ATTACHMENTS, GUEST_MESSAGE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH (+15 more)

### Community 30 - "Community 30"

Cohesion: 0.09
Nodes (19): buildRemoteOpenUrl(), EditorDefinition, EditorLaunchStyle, EDITORS, ExternalLauncherBrowserSpawnError, ExternalLauncherCommandNotFoundError, ExternalLauncherEditorSpawnError, ExternalLauncherError (+11 more)

### Community 31 - "Community 31"

Cohesion: 0.07
Nodes (21): VcsDriverCapabilities, VcsDriverKind, VcsFreshness, VcsFreshnessSource, VcsListRemotesResult, VcsListWorkspaceFilesResult, VcsOutputDecodeError, VcsProcessBoundaryErrorFields (+13 more)

### Community 32 - "Community 32"

Cohesion: 0.09
Nodes (21): ENVIRONMENT_MACHINE_KINDS, EnvironmentMachineKind, ExecutionEnvironmentCapabilities, ExecutionEnvironmentPlatform, ExecutionEnvironmentPlatformArch, ExecutionEnvironmentPlatformOs, isEnvironmentMachineKind, ORCHESTRATION_PROTOCOL_HEADER (+13 more)

### Community 33 - "Community 33"

Cohesion: 0.09
Nodes (22): ClaudeSettings, ClientSettingsPatch, ClientSettingsSchema, decodeClaudeSettings, DEFAULT_SERVER_SETTINGS, globalIdleCompaction(), idleCompactionPatch(), readsIdleCompactionModes() (+14 more)

### Community 34 - "Community 34"

Cohesion: 0.05
Nodes (35): PROJECT_CLONE_DETAIL_MAX_LENGTH, PROJECT_CLONE_ERROR_MAX_LENGTH, ProjectCloneActionInput, ProjectCloneActionResult, ProjectCloneListEvent, ProjectClonePhase, projectCloneProgressSummary(), ProjectCloneSnapshot (+27 more)

### Community 35 - "Community 35"

Cohesion: 0.09
Nodes (21): NodeId, RunAttemptId, latestProviderTurnForAttempt(), OrchestrationV2ProviderCapabilities, OrchestrationV2ProviderThread, OrchestrationV2ProviderThreadJson, OrchestrationV2RpcSchemas, OrchestrationV2Subagent (+13 more)

### Community 36 - "Community 36"

Cohesion: 0.14
Nodes (11): TrimmedNonEmptyString, DesktopBrowserCommand, DesktopBrowserEvent, TabKey, OrchestrationDispatchCommandError, WorktreeMcpContinuationStatus, WorktreeMcpFailure, WorktreeMcpHandoffInput (+3 more)

### Community 37 - "Community 37"

Cohesion: 0.12
Nodes (16): BROWSER_IMPORT_FAILURE_COPY, BROWSER_IMPORT_SOURCE_IDS, BROWSER_IMPORT_UNAVAILABLE_COPY, BrowserImportFailureReason, BrowserImportInput, BrowserImportResult, BrowserImportSource, BrowserImportSourceId (+8 more)

### Community 38 - "Community 38"

Cohesion: 0.12
Nodes (14): ProjectId, ThreadId, DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION, DesktopAppActivationErrorCode, DesktopAppActivationFailure, DesktopAppActivationPlatform, DesktopAppActivationSuccess, decodeProviderSendTurnInput (+6 more)

### Community 39 - "Community 39"

Cohesion: 0.11
Nodes (17): USAGE_CONTRACT_VERSION, USAGE_MERGE_COMPATIBLE_SINCE, UsageBucket, UsageCategoryCost, UsageCostSource, UsageDay, UsagePricing, UsagePricingStatus (+9 more)

### Community 40 - "Community 40"

Cohesion: 0.22
Nodes (9): AuthAccessTokenResult, AuthWebSocketTicketResult, DesktopAppActivationRequest, DesktopAppActivationResponse, EditorId, DesktopBridge, LocalApi, ClientSettings (+1 more)

### Community 41 - "Community 41"

Cohesion: 0.12
Nodes (16): ApplicationEventMetadata, ApplicationProjectCreatedEvent, ApplicationProjectCreatedPayload, ApplicationProjectDeletedEvent, ApplicationProjectDeletedPayload, ApplicationProjectEvent, ApplicationProjectEventBaseFields, ApplicationProjectMetaUpdatedEvent (+8 more)

### Community 42 - "Community 42"

Cohesion: 0.18
Nodes (10): ASSISTANT_CITATION_CONTEXT_LENGTH, ASSISTANT_CITATION_MAX_COMMENT_LENGTH, ASSISTANT_CITATION_MAX_TEXT_LENGTH, AssistantCitation, EnvironmentId, MessageId, NonNegativeInt, COMPOSER_CONTEXT_MAX_RECORDS (+2 more)

### Community 43 - "Community 43"

Cohesion: 0.04
Nodes (48): ApprovalId, ProgrammeApproval, ProgrammeBudgetExceededError, ProgrammeCapabilityUnavailableError, ProgrammeEvidence, ProgrammeEvidenceMissingError, ProgrammeInvalidRequestError, ProgrammePolicyDeniedError (+40 more)

### Community 44 - "Community 44"

Cohesion: 0.12
Nodes (14): ProviderConsumeResetCreditInput, ProviderConsumeResetCreditOutcome, ProviderConsumeResetCreditResult, ProviderUsageLimitsUpdate, ServerProviderResetCredits, ServerProviderUsageLimits, ServerProviderUsageWindow, UsageLimitSourceAccount (+6 more)

### Community 45 - "Community 45"

Cohesion: 0.13
Nodes (14): PullRequestActor, PullRequestChecksState, PullRequestMergeability, PullRequestReviewDecision, PullRequestState, decodeLinks, ThreadLinkedPullRequest, ThreadPullRequestKey (+6 more)

### Community 46 - "Community 46"

Cohesion: 0.12
Nodes (14): WORKTREE_SETUP_ACTIVITY_KIND, WORKTREE_SETUP_DETAIL_MAX_LENGTH, WORKTREE_SETUP_ERROR_MAX_LENGTH, WORKTREE_SETUP_STAGE_ORDER, WORKTREE_SETUP_TAIL_LINE_MAX_LENGTH, WorktreeSetupCancelInput, WorktreeSetupCancelResult, WorktreeSetupPhase (+6 more)

### Community 47 - "Community 47"

Cohesion: 0.13
Nodes (11): AgentSessionImportInput, AgentSessionImportProjectChangedError, AgentSessionImportProjectNotFoundError, AgentSessionImportResult, AgentSessionImportSource, AgentSessionProjectCandidate, AgentSessionProjectGit, AgentSessionScanError (+3 more)

### Community 48 - "Community 48"

Cohesion: 0.20
Nodes (10): BROWSER_PROFILE_MAX_COUNT, BROWSER_PROFILE_NAME_MAX_LENGTH, BrowserProfile, BrowserProfileKind, BrowserProfileName, BUILT_IN_BROWSER_PROFILES, DEFAULT_BROWSER_PROFILE_ID, INCOGNITO_BROWSER_PROFILE_ID (+2 more)

### Community 49 - "Community 49"

Cohesion: 0.14
Nodes (12): ExecutionEnvironmentDescriptor, decodeDescriptor, descriptor, OtlpEndpointCheckInput, resolveEnvironmentMachineKind(), ServerObservability, ServerProvider, ServerProviders (+4 more)

### Community 50 - "Community 50"

Cohesion: 0.14
Nodes (13): OrchestrationProjectShell, ProjectCreatePayload, ProjectFaviconPath, ProjectMutation, ProjectUpdatePayload, StoredProjectIcon, decodeFaviconPath, decodeProjectCreatePayload (+5 more)

### Community 51 - "Community 51"

Cohesion: 0.14
Nodes (15): AuthAccessWriteScope, AuthOrchestrationOperateScope, AuthOrchestrationReadScope, AuthPreviewOperateScope, AuthSettingsWriteScope, AuthSourceControlWriteScope, CLIENT_GUARDED_RPC_SCOPES, ClientGuardedRpcTag (+7 more)

### Community 52 - "Community 52"

Cohesion: 0.22
Nodes (10): CommandId, IsoDateTime, hasOnlyPairedSurrogates(), decodeUpdate, ThreadMetadataClientRequestId, ThreadMetadataMcpAction, ThreadMetadataMcpUpdateInput, ThreadMetadataMcpUpdateResult (+2 more)

### Community 53 - "Community 53"

Cohesion: 0.18
Nodes (10): decodedFilesystemBrowseErrorMessage(), FILESYSTEM_METADATA_BATCH_LIMIT, FilesystemBrowseEntry, FilesystemBrowseError, FilesystemBrowseFailure, FilesystemBrowseInput, FilesystemBrowseResult, FilesystemEntryMetadata (+2 more)

### Community 54 - "Community 54"

Cohesion: 0.28
Nodes (11): expandRecordIds(), internRecordIds(), isIdKey(), isIdListKey(), isObject(), JsonObject, ParsedJson, decode (+3 more)

### Community 55 - "Community 55"

Cohesion: 0.04
Nodes (46): RunId, AdmitBuildCompleteInput, ApprovalEffect, BuildCompletion, EvidenceId, EvidencePlan, GitCommitSha, MemberId (+38 more)

### Community 56 - "Community 56"

Cohesion: 0.17
Nodes (11): BackgroundBooleanState, BackgroundPolicySnapshot, BackgroundScope, ClientActivityClientId, ClientActivityLease, ClientActivityReportInput, ClientKind, HostPowerSnapshot (+3 more)

### Community 57 - "Community 57"

Cohesion: 0.17
Nodes (10): WorktreeSubmodules, ProjectScriptIcon, ProjectScopedServerSettingKey, PROJECT_FILE_BACKED_SETTINGS, ProjectFileBackedSettingKey, ResolvedServerSettings, T3_PROJECT_FILE_NAME, T3_PROJECT_FILE_SCHEMA_URL (+2 more)

### Community 58 - "Community 58"

Cohesion: 0.17
Nodes (10): McpAppCallToolInput, McpAppCallToolResult, McpAppReadResourceInput, McpAppReadResourceResult, McpAppRequestError, McpAppRequestErrorReason, McpAppTarget, McpAppToolInfo (+2 more)

### Community 59 - "Community 59"

Cohesion: 0.18
Nodes (6): decodedProjectErrorMessage(), ProjectListEntriesError, ProjectReadFileError, ProjectSearchContentsError, ProjectSearchEntriesError, ProjectWriteFileError

### Community 60 - "Community 60"

Cohesion: 0.20
Nodes (9): DeviceServiceState, EasDeviceHostConfig, EasDeviceHostConfigs, SshDeviceHostConfigs, decodeEas, decodeOlderState, decodeSshHosts, decodeState (+1 more)

### Community 61 - "Community 61"

Cohesion: 0.20
Nodes (9): RelayClientInstallFailedError, RelayClientInstallFailureReason, RelayClientInstallFailureReasonSchema, RelayClientInstallProgressEvent, RelayClientInstallProgressEventSchema, RelayClientInstallProgressStage, RelayClientInstallProgressStageSchema, RelayClientStatus (+1 more)

### Community 62 - "Community 62"

Cohesion: 0.20
Nodes (9): ReviewDiffFileContentsInput, ReviewDiffFileContentsResult, ReviewDiffFileStat, ReviewDiffPreviewError, ReviewDiffPreviewInput, ReviewDiffPreviewResult, ReviewDiffPreviewSource, ReviewDiffPreviewSourceKind (+1 more)

### Community 63 - "Community 63"

Cohesion: 0.25
Nodes (9): ForwardCompatibleUnion(), ForwardCompatibleUnionArray(), hasUnknownUnionTag(), knownTags(), OrchestrationV2ThreadHistoryPage, OrchestrationV2ThreadProjection, OrchestrationV2ThreadProjectionJson, projectedTurnItemArray() (+1 more)

### Community 64 - "Community 64"

Cohesion: 0.22
Nodes (8): OrchestrationGetFullThreadDiffError, OrchestrationGetFullThreadDiffInput, OrchestrationGetFullThreadDiffResult, OrchestrationGetTurnDiffError, OrchestrationGetTurnDiffInput, OrchestrationGetTurnDiffResult, ThreadTurnDiff, TurnCountRange

### Community 65 - "Community 65"

Cohesion: 0.22
Nodes (6): DEFAULT_TERMINAL_ID, TerminalError, TerminalOpenInput, TerminalProviderEnvironmentError, decodeTerminalError, encodeTerminalError

### Community 66 - "Community 66"

Cohesion: 0.25
Nodes (7): GuestShareId, ThreadGuestMessage, GuestShareView, GuestStreamEvent, GuestThreadModel, OrchestrationV2ThreadStreamItem, ProviderDriverKind

### Community 67 - "Community 67"

Cohesion: 0.25
Nodes (7): COMPOSER_CONTEXT_KINDS, ComposerContextRecord, OrchestrationMessageContext, base, decodeContext, decodeRecord, knownRecords

### Community 68 - "Community 68"

Cohesion: 0.20
Nodes (14): admitBuildComplete(), aggregateScope(), casOrFail(), commitReceipt(), expectRevision(), ProgrammeAuthorityPort, receiptScope(), recordReview() (+6 more)

### Community 69 - "Community 69"

Cohesion: 0.33
Nodes (5): MIN_SCHEDULED_TASK_INTERVAL_MS, ScheduledTaskSchedule, ScheduledTaskUpsertSchedule, decodeSchedule, decodeUpsertSchedule

### Community 70 - "Community 70"

Cohesion: 0.40
Nodes (4): OrchestratorMcpDelegateTaskInput, OrchestratorMcpDelegateTaskResult, decodeDelegateTaskInput, decodeDelegateTaskResult

### Community 71 - "Community 71"

Cohesion: 0.40
Nodes (4): decodeAutomationHost, decodeAutomationStatus, PreviewAutomationHost, PreviewAutomationStatus

### Community 72 - "Community 72"

Cohesion: 0.40
Nodes (5): defaultEnabledForDriver(), isUnconfiguredDefaultInstanceEnabled(), providerInstanceConfigEnabledFlag(), resolveProjectProviderInstanceEnabled(), resolveProviderInstanceEnabled()

### Community 73 - "Community 73"

Cohesion: 0.17
Nodes (11): ProviderOptionSelections, ModelSelection, ModelSelectionSource, ModelSelectionWire, PullRequestReviewGuide, PullRequestReviewGuideAttention, PullRequestReviewGuideExcerpt, PullRequestReviewGuideNote (+3 more)

### Community 74 - "Community 74"

Cohesion: 0.50
Nodes (3): RelayDeviceRegistrationRequest, decodeDevice, device

### Community 75 - "Community 75"

Cohesion: 0.67
Nodes (3): isUnknownUnionMember(), fromLegacyMonogram(), ReceivedProjectIcon

### Community 87 - "Community 87"

Cohesion: 0.29
Nodes (10): makeLabelledFixtureAuthorityPort(), makeMutationContext(), admitInput(), approvalVariant(), basePort(), decodeWire(), expectDecodeFails(), member() (+2 more)

### Community 88 - "Community 88"

Cohesion: 0.22
Nodes (8): AdvertisedEndpoint, AdvertisedEndpointCompatibility, AdvertisedEndpointHostedHttpsCompatibility, AdvertisedEndpointProvider, AdvertisedEndpointProviderKind, AdvertisedEndpointReachability, AdvertisedEndpointSource, AdvertisedEndpointStatus

### Community 97 - "Community 97"

Cohesion: 0.25
Nodes (6): GitCommandError, GitPreparePullRequestThreadResult, GitRunStackedActionInput, decodeGitCommandError, decodePreparePullRequestThreadResult, decodeRunStackedActionInput

### Community 98 - "Community 98"

Cohesion: 0.29
Nodes (5): TurnItemId, SECRET_REQUEST_FAILURE_MESSAGES, SecretRequestAnswerInput, SecretRequestError, SecretRequestFailureReason

### Community 99 - "Community 99"

Cohesion: 0.33
Nodes (3): ForwardCompatibleArray(), Shape, UnknownUnionMember

### Community 100 - "Community 100"

Cohesion: 0.40
Nodes (4): isBeforeOrAt(), pathIsExcluded(), requireApprovalCovering(), toEpochMillis()

### Community 101 - "Community 101"

Cohesion: 0.67
Nodes (3): getProviderAttachmentLimitError(), isProviderSendTurnSupportedImageMimeType(), ProviderSendTurnInput

## Knowledge Gaps

- **1913 isolated node(s):** `RpcScopeAuthorization`, `AccountRateLimitsUpdatedPayload`, `AccountUpdatedPayload`, `AuthStatusPayload`, `CanonicalItemType` (+1908 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **76 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `TrimmedNonEmptyString` connect `Community 36` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 30`, `Community 31`, `Community 32`, `Community 34`, `Community 35`, `Community 37`, `Community 38`, `Community 39`, `Community 41`, `Community 44`, `Community 45`, `Community 46`, `Community 47`, `Community 48`, `Community 52`, `Community 53`, `Community 55`, `Community 56`, `Community 58`, `Community 62`, `Community 64`, `Community 66`, `Community 73`, `Community 88`, `Community 98`, `Community 99`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `ThreadId` connect `Community 38` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 22`, `Community 23`, `Community 24`, `Community 27`, `Community 29`, `Community 32`, `Community 42`, `Community 46`, `Community 52`, `Community 56`, `Community 58`, `Community 64`, `Community 98`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `NonNegativeInt` connect `Community 42` to `Community 0`, `Community 1`, `Community 2`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 14`, `Community 18`, `Community 19`, `Community 22`, `Community 23`, `Community 24`, `Community 31`, `Community 34`, `Community 39`, `Community 41`, `Community 44`, `Community 45`, `Community 46`, `Community 47`, `Community 52`, `Community 53`, `Community 55`, `Community 64`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `RpcScopeAuthorization`, `AccountRateLimitsUpdatedPayload`, `AccountUpdatedPayload` to the rest of the system?**
  _1913 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.00966183574879227 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01092896174863388 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.011560693641618497 - nodes in this community are weakly interconnected._
