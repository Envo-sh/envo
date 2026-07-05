export type ProfileName = string;

export type AccountKind = "oauth" | "api_key";

export interface LinkedAccount {
  id: string;
  kind: AccountKind;
  label: string;
  provider: string;
}

export interface AuthEntry {
  provider: string;
  kind: "env" | "file";
  envKey?: string;
  targetPath?: string;
}

export interface AuthMaterializeResult {
  materialized: string[];
  skipped: string[];
}

export interface EnvoEnvironment {
  id: string;
  name: string;
  profile: ProfileName;
  target: string;
  agent: string;
  skills: string[];
  envFile: string;
  requiredKeys?: string[];
  auth?: AuthEntry[];
  createdAt: string;
}

export interface EnvoState {
  version: 1;
  projectId?: string;
  projectName?: string;
  profile: ProfileName;
  environments?: EnvoEnvironment[];
  connectedAt?: string;
  lastSyncDownAt?: string;
  lastSyncUpAt?: string;
  leaseExpiresAt?: string;
  accounts: LinkedAccount[];
  agents: string[];
  apiBase: string;
  lastPack?: PackPointer;
  lastPull?: PackPointer;
}

export type PackSkillKind = "bundled" | "ref";

export interface PackSkill {
  name: string;
  kind: PackSkillKind;
}

export interface PackManifest {
  version: 1;
  packVersion: number;
  project: string;
  environment: string;
  profile: ProfileName;
  harness?: string;
  /** legacy name for harness; always written for compatibility */
  runtime: string;
  target: string;
  secretKeys: string[];
  requiredKeys: string[];
  skills: PackSkill[];
  /** Layer-1 provider credentials carried by this pack (metadata only). */
  auth?: AuthEntry[];
  createdAt: string;
}

export interface PackResult {
  manifest: PackManifest;
  dir: string;
  warnings?: string[];
}

export interface MaterializeResult {
  manifest: PackManifest;
  envFile: string;
  skills: string[];
  refSkills: string[];
  runtime: string;
  contextFiles: string[];
  auth?: AuthMaterializeResult;
}

export interface PackPointer {
  environment: string;
  version: number;
  dir: string;
  createdAt?: string;
  pulledAt?: string;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
  hint?: string;
}

export interface DoctorReport {
  ok: boolean;
  profile: ProfileName;
  root: string;
  checks: DoctorCheck[];
}

export interface SecretEntry {
  key: string;
  profile: ProfileName;
  envFile: string;
}

export interface SkillEntry {
  name: string;
  environment: string;
}
