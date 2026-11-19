/**
 * Which public test cases the benchmark uses, and which Redline rule each one should (or should
 * not) trigger. Only pairs where the other tool's check means the same thing as the Redline rule
 * are listed; a check that is broader or narrower than any Redline rule is left out rather than
 * stretched to fit.
 */
import type { Kind } from "../packages/core/src/index";

export const KICS_REF = "v2.1.21";
export const GIXY = { name: "gixy-ng", version: "0.2.63" };

export type KicsQuery = { id: string; name: string; platform: "dockerfile" | "dockercompose" | "kubernetes"; rule: string };

export const KICS: KicsQuery[] = [
  // Dockerfile
  { platform: "dockerfile", id: "f45ea400-6bbe-4501-9fc7-1c3d75c32067", name: "Image Version Using 'latest'", rule: "DF001" },
  { platform: "dockerfile", id: "9efb0b2d-89c9-41a3-91ca-dcc0aec911fd", name: "Image Version Not Explicit", rule: "DF001" },
  { platform: "dockerfile", id: "67fd0c4a-68cf-46d7-8c41-bc9fba7e40ae", name: "Last User Is 'root'", rule: "DF002" },
  { platform: "dockerfile", id: "fd54f200-402c-4333-a5a4-36ef6709af2f", name: "Missing User Instruction", rule: "DF002" },
  { platform: "dockerfile", id: "9513a694-aa0d-41d8-be61-3271e056f36b", name: "Add Instead of Copy", rule: "DF004" },
  { platform: "dockerfile", id: "df746b39-6564-4fed-bf85-e9c44382303c", name: "Apt Get Install Lists Were Not Deleted", rule: "DF006" },
  { platform: "dockerfile", id: "8ada6e80-0ade-439e-b176-0b28f6bce35a", name: "Run Using Sudo", rule: "DF007" },
  { platform: "dockerfile", id: "5907595b-5b6d-4142-b173-dbb0e73fbff8", name: "Exposing Port 22 (SSH)", rule: "DF009" },
  { platform: "dockerfile", id: "99614418-f82b-4852-a9ae-5051402b741c", name: "MAINTAINER Instruction Being Used", rule: "DF010" },
  { platform: "dockerfile", id: "f2f903fb-b977-461e-98d7-b3e2185c6118", name: "Pip install Keeping Cached Packages", rule: "DF014" },
  // Docker Compose
  { platform: "dockercompose", id: "ae5b6871-7f45-42e0-bb4c-ab300c4d2026", name: "Privileged Containers Enabled", rule: "DC001" },
  { platform: "dockercompose", id: "d6355c88-1e8d-49e9-b2f2-f8a1ca12c75b", name: "Docker Socket Mounted In Container", rule: "DC002" },
  { platform: "dockercompose", id: "4f31dd9f-2cc3-4751-9b53-67e4af83dac0", name: "Host Namespace is Shared", rule: "DC003" },
  { platform: "dockercompose", id: "baa3890f-bed7-46f5-ab8f-1da8fc91c729", name: "Shared Host IPC Namespace", rule: "DC003" },
  { platform: "dockercompose", id: "071a71ff-f868-47a4-ac0b-3c59e4ab5443", name: "Shared Host Network Namespace", rule: "DC003" },
  { platform: "dockercompose", id: "404fde2c-bc4b-4371-9747-7054132ac953", name: "Default Seccomp Profile Disabled", rule: "DC007" },
  // Kubernetes
  { platform: "kubernetes", id: "dd29336b-fe57-445b-a26e-e6aa867ae609", name: "Container Is Privileged", rule: "K8S001" },
  { platform: "kubernetes", id: "cf34805e-3872-4c08-bf92-6ff7bb0cfadb", name: "Container Running As Root", rule: "K8S002" },
  { platform: "kubernetes", id: "5572cc5e-1e4c-4113-92a6-7a8a3bd25e6d", name: "Privilege Escalation Allowed", rule: "K8S003" },
  { platform: "kubernetes", id: "a9c2f49d-0671-4fc9-9ece-f4e261e128d0", name: "Root Container Not Mounted Read-only", rule: "K8S004" },
  { platform: "kubernetes", id: "268ca686-7fb7-4ae9-b129-955a2a89064e", name: "No Drop Capabilities for Containers", rule: "K8S005" },
  { platform: "kubernetes", id: "235236ee-ad78-4065-bd29-61b061f28ce0", name: "Containers With Sys Admin Capabilities", rule: "K8S006" },
  { platform: "kubernetes", id: "302736f4-b16c-41b8-befe-c0baffa0bd9d", name: "Shared Host PID Namespace", rule: "K8S007" },
  { platform: "kubernetes", id: "cd290efd-6c82-4e9d-a698-be12ae31d536", name: "Shared Host IPC Namespace", rule: "K8S007" },
  { platform: "kubernetes", id: "6b6bdfb3-c3ae-44cb-88e4-7405c1ba2c8a", name: "Shared Host Network Namespace", rule: "K8S007" },
  { platform: "kubernetes", id: "5308a7a8-06f8-45ac-bf10-791fe21de46e", name: "Workload Mounting With Sensitive OS Directory", rule: "K8S008" },
  { platform: "kubernetes", id: "a6f34658-fdfb-4154-9536-56d516f65828", name: "Docker Daemon Socket is Exposed to Containers", rule: "K8S008" },
  { platform: "kubernetes", id: "583053b7-e632-46f0-b989-f81ff8045385", name: "Invalid Image Tag", rule: "K8S009" },
  { platform: "kubernetes", id: "b14d1bc4-a208-45db-92f0-e21f8e2588e9", name: "Memory Limits Not Defined", rule: "K8S010" },
  { platform: "kubernetes", id: "48471392-d4d0-47c0-b135-cdec95eb3eef", name: "Service Account Token Automount Not Disabled", rule: "K8S012" },
  { platform: "kubernetes", id: "6b896afb-ca07-467a-b256-1a0077a1c08e", name: "RBAC Wildcard In Rule", rule: "K8S013" },
  { platform: "kubernetes", id: "249328b8-5f0f-409f-b1dd-029f07882e11", name: "Cluster Admin Rolebinding With Superuser Permissions", rule: "K8S014" },
];

/** gixy plugin folder -> Redline rules (a file counts as found if any of them fire). */
export const GIXY_PLUGINS: Record<string, string[]> = {
  version_disclosure: ["NG001"],
  weak_ssl_tls: ["NG002", "NG003"],
  hsts_header: ["NG005"],
  alias_traversal: ["NG007"],
  add_header_redefinition: ["NG008"],
  http_splitting: ["NG011"],
};

export const PLATFORM_KIND: Record<KicsQuery["platform"], Kind> = { dockerfile: "dockerfile", dockercompose: "compose", kubernetes: "kubernetes" };
