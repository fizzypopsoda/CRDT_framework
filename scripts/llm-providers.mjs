const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3-32b";

export function resolveChatProvider() {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    return {
        apiKey: key,
        url: GROQ_URL,
        model: process.env.LLM_MODEL || DEFAULT_MODEL,
        label: "Groq",
    };
}

export async function chatComplete(provider, messages, opts = {}) {
    const body = {
        model: provider.model,
        messages,
        max_tokens: opts.max_tokens ?? 800,
        temperature: opts.temperature ?? 0.3,
        top_p: opts.top_p ?? 0.95,
    };

    const res = await fetch(provider.url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(
            `${provider.label} ${res.status}: ${await res.text()}`
        );
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "(empty response)";
}
