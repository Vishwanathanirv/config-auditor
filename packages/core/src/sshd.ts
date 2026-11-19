import { deleteLines, insertBefore, replaceLine } from "./edits";
import type { Edit, Finding, Rule } from "./types";

export type SshLine = { key: string; value: string; line: number; match?: string };

export function parseSshd(text: string): SshLine[] {
  const out: SshLine[] = [];
  let match: string | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.replace(/#.*/, "").trim();
    if (!t) return;
    const m = t.match(/^(\S+)\s*(?:=\s*|\s+)(.*)$/) ?? [t, t, ""];
    const key = m[1].toLowerCase();
    if (key === "match") {
      match = m[2].trim();
      // "Match all" ends the conditional block.
      if (/^all$/i.test(match)) match = undefined;
      return;
    }
    out.push({ key, value: m[2].trim(), line: i + 1, match });
  });
  return out;
}

const ref = (label: string, url: string) => ({ label, url });
const MAN = ref("sshd_config manual", "https://man.openbsd.org/sshd_config");
const MOZ = ref("Mozilla OpenSSH guidelines", "https://infosec.mozilla.org/guidelines/openssh");
const CIS = ref("CIS Distribution Independent Linux Benchmark", "https://www.cisecurity.org/benchmark/distribution_independent_linux");

export const SSHD_RULES: Rule[] = [
  { id: "SSH001", kind: "sshd", title: "Root can log in with a password", severity: "high", autofix: true, why: "Every SSH scanner on the internet tries `root`. Allowing it gives them the one account that controls everything.", fix: "`PermitRootLogin no` (or `prohibit-password` if automation needs root with a key).", refs: [CIS, MOZ] },
  { id: "SSH002", kind: "sshd", title: "Password logins allowed", severity: "high", autofix: true, why: "Servers on the internet get thousands of password guesses a day. With passwords on, one weak password is enough. Keys can't be guessed.", fix: "Set up a key for your own login first, then `PasswordAuthentication no`.", refs: [CIS, MOZ] },
  { id: "SSH003", kind: "sshd", title: "Empty passwords allowed", severity: "critical", autofix: true, why: "Any account with no password set can log in with nothing at all.", fix: "`PermitEmptyPasswords no`", refs: [CIS] },
  { id: "SSH004", kind: "sshd", title: "Passwords still accepted through PAM", severity: "high", autofix: true, why: "With `UsePAM yes`, keyboard-interactive login asks for the password through PAM. So `PasswordAuthentication no` alone doesn't stop password guessing: the prompt just arrives a different way.", fix: "Also set `KbdInteractiveAuthentication no` (older versions: `ChallengeResponseAuthentication no`).", refs: [MAN] },
  { id: "SSH005", kind: "sshd", title: "SSH protocol 1 enabled", severity: "critical", autofix: true, why: "Protocol 1 is broken and was removed from OpenSSH in 2017. If your server accepts it, it's very old and unpatched.", fix: "Remove the `Protocol` line; modern OpenSSH only speaks protocol 2.", refs: [MAN] },
  { id: "SSH006", kind: "sshd", title: "Weak ciphers, MACs or key exchange", severity: "high", autofix: true, why: "CBC ciphers, arcfour, MD5 and SHA-1 MACs, and 1024-bit Diffie-Hellman have known weaknesses, and allowing them lets an attacker push a connection down to them.", fix: "Remove the weak algorithms; the OpenSSH defaults are good, so deleting the line is often best.", refs: [MOZ] },
  { id: "SSH007", kind: "sshd", title: "X11 forwarding on", severity: "low", autofix: true, why: "A compromised server can use a forwarded X11 session to watch or type into the client's desktop.", fix: "`X11Forwarding no`", refs: [CIS] },
  { id: "SSH008", kind: "sshd", title: "Too many password tries per connection", severity: "low", autofix: true, why: "Each connection gets this many guesses before being dropped, which speeds up brute force.", fix: "`MaxAuthTries 3`", refs: [CIS] },
  { id: "SSH009", kind: "sshd", title: "A setting is ignored: the first one wins", severity: "high", autofix: true, why: "Unlike most config files, sshd uses the first value it reads and ignores later ones. A hardening line added at the bottom of the file does nothing if the same setting appears earlier, including in an `Include`d file.", fix: "Delete the earlier line so your intended value takes effect, then confirm with `sudo sshd -T`.", refs: [MAN] },
  { id: "SSH010", kind: "sshd", title: "Users can set environment variables", severity: "medium", autofix: true, why: "`PermitUserEnvironment yes` lets users set variables like `LD_PRELOAD` from `~/.ssh/environment`, which can get around forced commands and other restrictions.", fix: "`PermitUserEnvironment no`", refs: [CIS] },
  { id: "SSH011", kind: "sshd", title: "Forwarded ports open to the network", severity: "medium", autofix: true, why: "`GatewayPorts yes` makes ports a user forwards reachable by anyone on the network, not just the server itself.", fix: "`GatewayPorts no`", refs: [MAN] },
  { id: "SSH012", kind: "sshd", title: "Included files can override this file", severity: "low", autofix: false, why: "Because the first value wins, a file pulled in by `Include` near the top beats anything set below it. On Ubuntu cloud images, `50-cloud-init.conf` turns password login back on this way.", fix: "Check the included files, and check what's really in force with `sudo sshd -T | grep -i -E 'password|root'`.", refs: [MAN] },
];

const WEAK = {
  ciphers: /(-cbc$|^arcfour|^3des|^blowfish|^cast128|^rijndael)/i,
  macs: /(md5|^hmac-sha1$|^hmac-sha1-96|^umac-64@|^hmac-ripemd|-96$)/i,
  kexalgorithms: /(^diffie-hellman-group1-|^diffie-hellman-group14-sha1$|^diffie-hellman-group-exchange-sha1$|^gss-)/i,
};
const BAD: Record<string, { value: RegExp; rule: string; good: string; say: string }> = {
  permitrootlogin: { value: /^yes$/i, rule: "SSH001", good: "PermitRootLogin no", say: "Root can log in, with a password too." },
  passwordauthentication: { value: /^yes$/i, rule: "SSH002", good: "PasswordAuthentication no", say: "Password logins are on." },
  permitemptypasswords: { value: /^yes$/i, rule: "SSH003", good: "PermitEmptyPasswords no", say: "Accounts with no password can log in." },
  x11forwarding: { value: /^yes$/i, rule: "SSH007", good: "X11Forwarding no", say: "X11 forwarding is on." },
  permituserenvironment: { value: /^(yes|.*\S.*)$/i, rule: "SSH010", good: "PermitUserEnvironment no", say: "Users can set their own environment." },
  gatewayports: { value: /^(yes|clientspecified)$/i, rule: "SSH011", good: "GatewayPorts no", say: "Forwarded ports can be reached from the network." },
};
const isNo = (v: string) => /^no$/i.test(v);
const casing: Record<string, string> = { permitrootlogin: "PermitRootLogin", passwordauthentication: "PasswordAuthentication", permitemptypasswords: "PermitEmptyPasswords", x11forwarding: "X11Forwarding", permituserenvironment: "PermitUserEnvironment", gatewayports: "GatewayPorts", kbdinteractiveauthentication: "KbdInteractiveAuthentication", challengeresponseauthentication: "ChallengeResponseAuthentication", usepam: "UsePAM", maxauthtries: "MaxAuthTries", ciphers: "Ciphers", macs: "MACs", kexalgorithms: "KexAlgorithms", protocol: "Protocol" };

/** True when the text looks like an sshd config rather than any key-value file. */
export const looksLikeSshd = (text: string) => /^\s*(PermitRootLogin|PasswordAuthentication|ChallengeResponseAuthentication|KbdInteractiveAuthentication|Subsystem\s+sftp|UsePAM|AuthorizedKeysFile|HostKey|PubkeyAuthentication)\b/im.test(text);

export function checkSshd(text: string): Finding[] {
  const all = parseSshd(text);
  const lines = text.split(/\r?\n/);
  const out: Finding[] = [];
  const sev = (id: string) => SSHD_RULES.find((r) => r.id === id)!.severity;
  const add = (rule: string, line: number, message: string, edits?: Edit[], severity = sev(rule)) => out.push({ rule, severity, line, message, edits });
  const global = all.filter((l) => !l.match);
  const first = new Map<string, SshLine>();
  for (const l of global) if (!first.has(l.key)) first.set(l.key, l);
  // Where to add settings that aren't in the file: before the first Match block, or at the end.
  const firstMatch = lines.findIndex((l) => /^\s*Match\s/i.test(l));
  const insertAt = firstMatch >= 0 ? firstMatch + 1 : lines.length + (lines.at(-1) === "" ? 0 : 1);
  const setting = (key: string, good: string): Edit[] => {
    const f = first.get(key);
    return f ? [replaceLine(f.line, good, lines)] : [{ ...insertBefore(insertAt, [good]), merge: { key: "sshd-add", header: [] } }];
  };

  // SSH009: later duplicates are ignored. When the value that wins is the insecure one, the
  // finding goes on that winning line, since that's the line to delete.
  const shadowed = new Set<string>();
  for (const l of global) {
    const f = first.get(l.key)!;
    if (f === l || f.value.toLowerCase() === l.value.toLowerCase()) continue;
    const bad = BAD[l.key];
    if (bad && bad.value.test(f.value) && !isNo(f.value) && !bad.value.test(l.value)) {
      if (shadowed.has(l.key)) continue;
      shadowed.add(l.key);
      add("SSH009", f.line, `\`${casing[l.key] ?? l.key} ${f.value}\` wins over \`${l.value}\` on line ${l.line}: sshd uses the first value it reads, so your later line does nothing.`, [deleteLines(f.line)], "high");
    } else add("SSH009", l.line, `\`${casing[l.key] ?? l.key} ${l.value}\` is ignored: line ${f.line} already set it to \`${f.value}\`, and the first value wins.`, [deleteLines(l.line)], "low");
  }

  for (const [key, b] of Object.entries(BAD)) {
    const f = first.get(key);
    if (key === "passwordauthentication" && !f) {
      add("SSH002", 1, "`PasswordAuthentication` isn't set, and the default is yes.", setting(key, b.good));
      continue;
    }
    if (f && b.value.test(f.value) && !isNo(f.value) && !shadowed.has(key)) add(b.rule, f.line, b.say, setting(key, b.good));
    // The same setting turned on for some users only.
    for (const m of all.filter((l) => l.match && l.key === key && b.value.test(l.value) && !isNo(l.value))) add(b.rule, m.line, `${b.say} (for \`Match ${m.match}\`)`, undefined, "medium");
  }

  const pam = first.get("usepam");
  const pw = first.get("passwordauthentication");
  const kbd = first.get("kbdinteractiveauthentication") ?? first.get("challengeresponseauthentication");
  if (pam && /^yes$/i.test(pam.value) && pw && isNo(pw.value) && (!kbd || !isNo(kbd.value))) {
    add("SSH004", kbd?.line ?? pw.line, kbd ? `\`${casing[kbd.key]} ${kbd.value}\` with \`UsePAM yes\` still asks for passwords.` : "`KbdInteractiveAuthentication` isn't set (default yes), so PAM still asks for passwords.", kbd ? [replaceLine(kbd.line, `${casing[kbd.key]} no`, lines)] : setting("kbdinteractiveauthentication", "KbdInteractiveAuthentication no"));
  }

  const proto = first.get("protocol");
  if (proto && /1/.test(proto.value)) add("SSH005", proto.line, `\`Protocol ${proto.value}\` allows protocol 1.`, [deleteLines(proto.line)]);

  for (const k of ["ciphers", "macs", "kexalgorithms"] as const) {
    const f = first.get(k);
    if (!f) continue;
    const list = f.value.replace(/^[+^-]/, "").split(",");
    if (f.value.startsWith("-")) continue;
    const weak = list.filter((a) => WEAK[k].test(a));
    if (!weak.length) continue;
    const keep = list.filter((a) => !WEAK[k].test(a));
    add("SSH006", f.line, `${casing[k]} allows ${weak.join(", ")}.`, [keep.length ? replaceLine(f.line, `${casing[k]} ${f.value.startsWith("+") ? "+" : ""}${keep.join(",")}`, lines) : deleteLines(f.line)]);
  }

  const tries = first.get("maxauthtries");
  if (tries && +tries.value > 4) add("SSH008", tries.line, `${tries.value} tries per connection.`, [replaceLine(tries.line, "MaxAuthTries 3", lines)]);

  const inc = global.find((l) => l.key === "include");
  if (inc) add("SSH012", inc.line, `Settings in \`${inc.value}\` win over anything set later in this file.`);
  return out;
}
