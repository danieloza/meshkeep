// Ready-made settings for providers whose API speaks the OpenAI format, and
// recognition of a pasted key. It runs in the browser on the pasted string
// alone: nothing here sends the key anywhere, logs it or keeps it. A key is
// recognized only by a prefix that belongs to one vendor. A key that several
// vendors could have issued gets a choice, never a guess and never a probe:
// trying it against each candidate would hand the secret to companies it
// does not belong to.
//
// Sources, checked 2026-11-04:
// - Base URLs, from each provider's API documentation:
//   OpenAI https://platform.openai.com/docs/api-reference
//   Anthropic https://platform.claude.com/docs/en/api/openai-sdk
//   Google https://aistudio.google.com/docs/openai
//   OpenRouter https://openrouter.ai/docs/api-reference/authentication
//   Groq https://console.groq.com/docs/openai
//   xAI https://docs.x.ai/docs/api-reference
//   DeepSeek https://api-docs.deepseek.com/
//   Kimi https://platform.kimi.ai/docs/api/chat
//   Mistral https://docs.mistral.ai/api/
// - Key prefixes, from the secret scanners' published rules, since most
//   providers do not document them: gitleaks `config/gitleaks.toml` (Anthropic,
//   OpenAI, Google API key) and trufflehog `pkg/detectors` (Anthropic, OpenAI,
//   OpenRouter, Groq, xAI). Anthropic's own docs name `sk-ant-api…` keys.

export const PROVIDER_PRESET_IDS = ['openai', 'anthropic', 'google', 'openrouter', 'groq', 'xai', 'deepseek', 'moonshot', 'mistral'] as const;
export type ProviderPresetId = (typeof PROVIDER_PRESET_IDS)[number];

export type ProviderPreset = { id: ProviderPresetId; label: string; baseUrl: string; note?: string };

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
  openai: { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    note: 'This goes through Anthropic’s OpenAI compatibility layer, which Anthropic describes as a way to test models rather than a long-term production path. Effort is ignored there, and a key that is not scoped to one workspace is refused.',
  },
  google: { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    note: 'OpenRouter lists its models without a key, so a wrong key shows up at the first message rather than here.',
  },
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  xai: { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  moonshot: { id: 'moonshot', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1' },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
};

// Checked in order, so a longer prefix wins over `sk-`. `by` is what the form
// may say the key was recognized by; it is never the key itself.
type Rule = { matches: (key: string) => boolean; preset: ProviderPresetId; by: string };
const prefix = (start: string, preset: ProviderPresetId): Rule => ({ matches: (key) => key.startsWith(start), preset, by: `the ${start} prefix` });

const RULES: Rule[] = [
  prefix('sk-ant-', 'anthropic'),
  prefix('sk-or-', 'openrouter'),
  prefix('sk-proj-', 'openai'),
  prefix('sk-svcacct-', 'openai'),
  // Every OpenAI key carries this marker, Base64 for "OpenAI", older ones too.
  { matches: (key) => key.startsWith('sk-') && key.includes('T3BlbkFJ'), preset: 'openai', by: 'its OpenAI marker' },
  prefix('gsk_', 'groq'),
  prefix('xai-', 'xai'),
  prefix('AIza', 'google'),
];

// A plain `sk-` key: DeepSeek and Kimi issue these, and so might others.
const PLAIN_SK: ProviderPresetId[] = ['deepseek', 'moonshot', 'openai'];

export type KeyRecognition =
  | { kind: 'none' }
  | { kind: 'recognized'; preset: ProviderPreset; by: string }
  | { kind: 'ambiguous'; presets: ProviderPreset[] }
  | { kind: 'unknown' };

export function recognizeKey(raw: string): KeyRecognition {
  const key = raw.trim();
  if (!key) return { kind: 'none' };
  const rule = RULES.find((candidate) => candidate.matches(key));
  if (rule) return { kind: 'recognized', preset: PROVIDER_PRESETS[rule.preset], by: rule.by };
  if (key.startsWith('sk-')) return { kind: 'ambiguous', presets: PLAIN_SK.map((id) => PROVIDER_PRESETS[id]) };
  return { kind: 'unknown' };
}

export function isProviderPresetId(value: string): value is ProviderPresetId {
  return (PROVIDER_PRESET_IDS as readonly string[]).includes(value);
}
