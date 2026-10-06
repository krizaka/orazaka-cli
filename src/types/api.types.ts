/**
 * @file api.types.ts
 * @description GraphQL and REST API response types and contracts for Orazaka.
 */

// ── GraphQL Schema Types ─────────────────────────────────────────────────────

export interface ChatResponse {
  readonly content: string;
  readonly conversationId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UserProfile {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly authorities: readonly string[];
  readonly preferences: Record<string, unknown> | null;
}

export interface RegisterResult {
  readonly user: UserProfile | null;
  readonly error: string | null;
}

// ── Operation Graph (SDUI) ───────────────────────────────────────────────────

export type NodeStateType = 'ACTIVE' | 'LOCKED' | 'INVISIBLE';

export interface ActiveNodeState {
  readonly type: 'ACTIVE';
}

export interface LockedNodeState {
  readonly type: 'LOCKED';
  readonly reason: string;
  readonly lockedAt?: string;
}

export interface InvisibleNodeState {
  readonly type: 'INVISIBLE';
}

export type NodeState = ActiveNodeState | LockedNodeState | InvisibleNodeState;

export interface TargetExecutionUri {
  readonly uriPath: string;
  readonly httpMethod: string;
  readonly payloadTemplate?: string;
}

/**
 * One capability of the operation graph: its identity and whether it can run right now.
 *
 * It carried a label, an icon and a `TargetExecutionUri` until ADR-069 §5. Those came from the
 * registry's UI-manifest columns, whose endpoints door 1 owned and which are deleted; a display
 * name belongs to the pack that ships the Studio, and the one synchronous endpoint left is the
 * conversation service's own route.
 */
export interface OperationNode {
  readonly id: string;
  readonly presentationContext: string;
  readonly state: NodeState;
}

// ── Timeline & Rendering ─────────────────────────────────────────────────────

export interface TextTimelineMessage {
  readonly kind: 'text';
  readonly content: string;
}

export interface ImageTimelineMessage {
  readonly kind: 'image';
  readonly content: string;
}

export interface AudioTimelineMessage {
  readonly kind: 'audio';
  readonly content: string;
}

export interface VideoTimelineMessage {
  readonly kind: 'video';
  readonly content: string;
}

export type TimelineMessage =
  | TextTimelineMessage
  | ImageTimelineMessage
  | AudioTimelineMessage
  | VideoTimelineMessage;

// ── Capability Descriptors ───────────────────────────────────────────────────

export interface CapabilityDescriptor {
  readonly id: string;
  readonly flag: string;
  readonly argName: string;
  readonly description: string;
  readonly renderKind: TimelineMessage['kind'];
  readonly responseField: 'content' | 'analysis';
  readonly processExtraParams?: (
    val: string,
    conversationId?: string,
  ) => Promise<Record<string, string>> | Record<string, string>;
}

export interface ChatInput {
  readonly flag?: string;
  readonly flagValue?: string;
  readonly prompt: string;
}
