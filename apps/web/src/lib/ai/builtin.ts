import type { Check } from "@contract/types";
import upgrades from "../../../../../data/upgrades.json";
import { formatInt, NETWORK_LABEL } from "../format";
import type { AskEnv, AskSubject } from "./subject";
import type { ZipSection } from "./zips";

export type QuickPrompt = "explain" | "rule" | "audit" | "height";

export const QUICK_PROMPTS: { id: QuickPrompt; label: string }[] = [
  { id: "explain", label: "Explain this part" },
  { id: "rule", label: "Why does this rule pass or fail here?" },
  { id: "audit", label: "What should an auditor check?" },
  { id: "height", label: "What would change at another height?" },
];

interface Topic {
  explain: string;
  audit: string[];
}

const TOPICS: Record<string, Topic> = {
  TX: {
    explain:
      "The whole transaction. For v5 and v6 the txid is not a hash of these bytes: it is the ZIP 244 digest tree over the header, transparent, Sapling and Orchard parts (plus Ironwood in v6, ZIP 229), so signatures and proofs do not change it. For v4 the txid is the double SHA-256 of the bytes.",
    audit: [
      "Version and version group match the network upgrade at the mined height.",
      "Every bundle is either empty or well formed; nothing trails after the last field.",
      "The fee (sum of all pool balances) is not negative and meets the conventional fee.",
    ],
  },
  HEADER: {
    explain:
      "The header says how to read the rest: version (with the fOverwintered bit), version group id, and from v5 the consensus branch id, then lock_time and nExpiryHeight (ZIP 225). The branch id must be the one of the upgrade active at the height of the block that includes it; ZIP 244 commits it into the txid through header_digest. nExpiryHeight is the last height the transaction may be mined at, 0 means no expiry (ZIP 203).",
    audit: [
      "consensusBranchId equals the branch id of the upgrade active at the target height.",
      "versionGroupId matches the version (v5 0x26a7270a; v6 per ZIP 229).",
      "expiryHeight is 0 or not below the target height, and within the ZIP 203 limit.",
    ],
  },
  TRANSPARENT: {
    explain: "The transparent bundle is the Bitcoin-style public part: inputs spend earlier outputs by txid and index, outputs pay a value to a script. Everything here is visible to anyone.",
    audit: ["Each input's prevout exists and is unspent at the target height.", "Output values are in range and scripts are standard.", "A coinbase input appears only in a coinbase transaction."],
  },
  VIN: {
    explain: "A transparent input. prevout points to the output it spends (txid:index), scriptSig unlocks it, sequence is the Bitcoin-style sequence number. The input value is not stored here; Luora reads it from the spent output to compute the fee.",
    audit: ["The prevout is unspent and its value is known before judging the fee.", "scriptSig satisfies the spent scriptPubKey (Zebra checks this in its script stage)."],
  },
  VOUT: {
    explain: "A transparent output: a public value in zatoshi and a scriptPubKey. The address shown is decoded from the script; anyone can see both.",
    audit: ["value is within the money range.", "scriptPubKey is a standard P2PKH or P2SH script if the output should be spendable."],
  },
  SAPLING: {
    explain:
      "The Sapling bundle holds shielded spends and outputs proved with Groth16. valueBalanceSapling is the net value leaving the Sapling pool (positive means value moves out to other pools or the fee). Amounts, senders and recipients inside notes are encrypted and cannot be known from public data.",
    audit: ["Each spend and output carries a 192-byte Groth16 proof.", "valueBalanceSapling is consistent with the binding signature.", "The anchor is a valid Sapling note commitment tree root."],
  },
  SPEND: {
    explain:
      "A shielded spend. cv is a value commitment, nullifier marks the spent note so it cannot be spent twice, rk is the randomized key its spendAuthSig verifies against. Which note it spends and its amount stay hidden.",
    audit: ["The nullifier was not revealed before (double-spend check in Zebra's state).", "The proof and spendAuthSig are present and verify."],
  },
  OUTPUT: {
    explain:
      "A shielded output. cmu is the note commitment added to the tree, ephemeralKey and the two ciphertexts (580 B and 80 B) let only the recipient (or the sender with the outgoing key) decrypt the note. Recipient and amount stay hidden.",
    audit: ["Ciphertext sizes are 580 and 80 bytes.", "The Groth16 output proof is present and verifies."],
  },
  ORCHARD: {
    explain:
      "The Orchard bundle is a list of actions, each one spend plus one output, with a single aggregated Halo 2 proof. flags turn spends and outputs on or off; valueBalanceOrchard is the net value leaving the pool. ZIP 257 fixes the canonical proof length at 2720 + 2272 × actions bytes.",
    audit: ["Proof length equals 2720 + 2272 × actions (ZIP 257).", "Reserved flag bits are zero.", "valueBalance and bindingSig agree; anchor is a valid Orchard root."],
  },
  IRONWOOD: {
    explain:
      "Ironwood is the fourth pool added by NU6.3 with the v6 transaction format (ZIP 229). Its bundle has the same action shape as Orchard: actions, flags, value balance, anchor, one Halo 2 proof and a binding signature. Some explorers still show these transfers as 0 ZEC because they do not read the v6 field.",
    audit: ["Only present in v6 transactions at or after NU6.3.", "Proof length follows the Orchard-style canonical size.", "Reserved flag bits are zero (ZIP 229)."],
  },
  ACTION: {
    explain:
      "One Orchard-style action: it spends one note (nullifier, rk) and creates one note (cmx, ephemeralKey, ciphertexts) with a net value commitment cv. Either half can be a dummy, so the count of actions does not reveal how many real notes moved.",
    audit: ["Nullifier is new to the chain.", "Ciphertext sizes are 580 and 80 bytes.", "A spendAuthSig exists for this action."],
  },
  BALANCE: {
    explain: "The value balance of a shielded pool: the net amount in zatoshi leaving that pool in this transaction. It is the only public number about value in the shielded part.",
    audit: ["The fee formula (transparent in − out + all value balances) is not negative."],
  },
  PROOF: {
    explain: "A zero-knowledge proof that the shielded part follows the rules without showing amounts or keys. Sapling uses one 192-byte Groth16 proof per spend and output; Orchard and Ironwood use one Halo 2 proof per bundle. Luora checks presence and size here, not the maths.",
    audit: ["Size matches the canonical size for this pool.", "Full verification happens in Zebra's proof stage."],
  },
  "AUTH SIG": {
    explain: "A spend authorization signature (64 bytes) under the randomized key rk. It proves the spender holds the spending key without revealing which key.",
    audit: ["Exactly one per spend or action.", "Verifies against rk and the signature digest (ZIP 244 for v5 and later, ZIP 243 for v4)."],
  },
  "BINDING SIG": {
    explain: "The binding signature (64 bytes) proves that the value commitments of a pool add up to its declared value balance, so no value is created inside the shielded pool.",
    audit: ["Present whenever the bundle is not empty.", "Verifies against the sum of cv values and valueBalance."],
  },
  JOINSPLITS: {
    explain: "Sprout JoinSplits: the original shielded pool. v5 and v6 transactions cannot carry them; in v4 this list is normally empty.",
    audit: ["Empty unless this is a legacy v2 to v4 transaction."],
  },
  FEE: {
    explain:
      "The fee is not stored in the transaction. It is the sum of transparent inputs minus transparent outputs plus every pool's value balance. ZIP 317 sets the conventional fee from the number of logical actions; ZIP 2009 lowers the marginal fee per action.",
    audit: ["All transparent input values are known before judging the fee.", "The fee is at least the ZIP 317 conventional fee, or nodes may refuse to relay or mine it."],
  },
  CHECK: {
    explain: "A rule Luora ran in this tab with librustzcash against the public structure.",
    audit: ["Read the ZIP clause it cites.", "Re-run it at the mined height and at the tip to see if the outcome depends on the upgrade."],
  },
  ZEBRA: {
    explain: "An error variant from Zebra's source. Zebra returns these through sendrawtransaction as one generic RPC error, so the variant tells you which stage refused the transaction.",
    audit: ["Find the stage (router, mempool, transaction verifier, script, proofs, state).", "Fix the input the message points at, then rebroadcast."],
  },
  PCZT: {
    explain:
      "A PCZT action as described by ZIP 374. The committed recipient is what the action actually pays; the address shown to the signer (user_address) is only a hint. Signers today do not compare the two (librustzcash #3155), so a mismatch must be caught before signing.",
    audit: ["recipient equals the address the user saw.", "value is set and matches what the user approved.", "Proof and signature present before Extractor runs."],
  },
};

const NODE_TOPIC: Record<string, string> = {
  "node:tx": "TX",
  "node:header": "HEADER",
  "node:transparent": "TRANSPARENT",
  "node:sapling": "SAPLING",
  "node:orchard": "ORCHARD",
  "node:ironwood": "IRONWOOD",
  "node:fee": "FEE",
};

const HEIGHT_SENSITIVE = /branch|upgrade|nu6|nu5|ironwood|expiry|zip317|fee|turnstile|v6|version/i;

function topicFor(subject: AskSubject): Topic {
  if (subject.kind === "check") return TOPICS.CHECK;
  if (subject.kind === "zebra") return TOPICS.ZEBRA;
  if (subject.kind === "pczt") return TOPICS.PCZT;
  if (subject.kind === "node") return TOPICS[NODE_TOPIC[subject.key] ?? "TX"];
  const kind = subject.title.split(" ").slice(0, 2).join(" ");
  return TOPICS[kind] ?? TOPICS[subject.title.split(" ")[0]] ?? TOPICS.TX;
}

function checkLine(check: Check): string {
  const zip = check.zip ? ` (ZIP ${check.zip.number}${check.zip.clause ? ` § ${check.zip.clause}` : ""})` : "";
  return `- #${check.id} ${check.status === "na" ? "not applicable" : check.status}: ${check.detail}${zip}`;
}

function excerptLine(excerpt: ZipSection): string {
  const sentence = excerpt.text
    .split("\n")
    .filter((line) => !/^\s*(\||::|\.\. )/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[`*]/g, "")
    .trim();
  const short = sentence.length > 320 ? `${sentence.slice(0, 320).replace(/\s\S*$/, "")} …` : sentence;
  return `From ZIP ${excerpt.zip} § ${excerpt.trail.slice(1).join(" > ") || excerpt.heading}: “${short}”`;
}

function upgradesAround(env: AskEnv): string[] {
  if (env.height === null) return [];
  const list = (upgrades.networks as Record<string, { name: string; activationHeight: number | null; branchId: string | null }[]>)[env.network] ?? [];
  const dated = list.filter((item): item is { name: string; activationHeight: number; branchId: string | null } => item.activationHeight !== null);
  const active = [...dated].reverse().find((item) => item.activationHeight <= env.height!);
  const next = dated.find((item) => item.activationHeight > env.height!);
  const previous = active ? dated[dated.indexOf(active) - 1] : undefined;
  const lines: string[] = [];
  if (active) lines.push(`- At ${formatInt(env.height)} the active upgrade on ${NETWORK_LABEL[env.network]} is ${active.name} (from ${formatInt(active.activationHeight)}${active.branchId ? `, branch id ${active.branchId}` : ""}).`);
  if (previous) lines.push(`- Below ${formatInt(active!.activationHeight)} the rules of ${previous.name} apply${previous.branchId ? ` (branch id ${previous.branchId})` : ""}.`);
  if (next) lines.push(`- From ${formatInt(next.activationHeight)} ${next.name} applies${next.branchId ? ` (branch id ${next.branchId})` : ""}.`);
  else lines.push("- No later upgrade with a fixed height is known in Luora's upgrade table.");
  return lines;
}

export function builtinAnswer(prompt: QuickPrompt | null, question: string, subject: AskSubject, env: AskEnv, excerpts: ZipSection[]): string {
  const topic = topicFor(subject);
  const lines: string[] = [];
  const fieldLines = subject.fields.slice(0, 8).map((field) => `- ${field.name} = ${field.display === field.value ? field.value : `${field.display}${field.privacy === "public" && field.value.length <= 24 ? ` (${field.value})` : ""}`}`);
  const failing = subject.checks.filter((check) => check.status === "fail" || check.status === "warn");
  const where = subject.offset !== null ? ` at ${subject.key}` : "";

  if (prompt === "rule") {
    if (subject.checks.length === 0) {
      lines.push(`No rule Luora runs is tied directly to ${subject.title}${where}. The rules for the whole transaction are in the Rules tab.`);
    } else {
      const count = subject.checks.length;
      lines.push(
        failing.length
          ? `${failing.length} of ${count} related rule${count === 1 ? "" : "s"} need${failing.length === 1 ? "s" : ""} attention ${env.heightLabel}:`
          : count === 1
            ? `The related rule ${subject.checks[0].status === "na" ? "does not apply" : "passes"} ${env.heightLabel}:`
            : `All ${count} related rules pass or do not apply ${env.heightLabel}:`,
      );
      lines.push(...subject.checks.map(checkLine));
      const sources = subject.checks.flatMap((check) => (check.source ? [check.source] : []));
      if (sources.length) lines.push("", `Each rule mirrors the source line it cites, e.g. ${sources[0]}.`);
    }
  } else if (prompt === "audit") {
    lines.push(`For ${subject.title}${where}, check:`);
    lines.push(...topic.audit.map((item) => `- ${item}`));
    if (failing.length) lines.push("", "Already flagged here:", ...failing.map(checkLine));
  } else if (prompt === "height") {
    const sensitive = subject.checks.filter((check) => HEIGHT_SENSITIVE.test(`${check.id} ${check.title}`));
    lines.push("Which rules apply depends on the network upgrade active at the height, so the same bytes can pass at one height and fail at another.");
    lines.push(...upgradesAround(env));
    if (sensitive.length) lines.push("", "Related rules that depend on height:", ...sensitive.map(checkLine));
    lines.push("", "Try it: Rules → Check at → another height.");
  } else {
    lines.push(`${subject.title}${where}${subject.parents.length ? `, inside ${subject.parents.join(" › ")}` : ""}.`);
    lines.push("", topic.explain);
    for (const note of subject.notes) lines.push("", note);
    if (fieldLines.length) lines.push("", "Here:", ...fieldLines);
    if (failing.length) lines.push("", "Flagged:", ...failing.map(checkLine));
    if (prompt === null && question.trim()) lines.push("", "Built-in answers cover the four quick questions. For a free question, connect an AI in Connect AI; until then, here is the closest ZIP text.");
  }
  if (excerpts[0]) lines.push("", excerptLine(excerpts[0]));
  return lines.join("\n");
}
