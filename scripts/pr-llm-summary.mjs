import { chatComplete, resolveChatProvider } from "./llm-providers.mjs";

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY || "";
const prNumber = process.env.PR_NUMBER;

const [owner, repo] = repoFull.split("/");
if (!owner || !repo || !prNumber || !token) {
    console.error("Missing GITHUB_REPOSITORY, PR_NUMBER, or GITHUB_TOKEN");
    process.exit(1);
}

const api = (path, init = {}) =>
    fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${token}`,
            "User-Agent": "pr-llm-summary-action",
            ...init.headers,
        },
    });

async function getDiff() {
    const res = await api(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: { Accept: "application/vnd.github.diff" },
    });
    if (!res.ok) throw new Error(`diff ${res.status}: ${await res.text()}`);
    return res.text();
}

async function listFiles() {
    const res = await api(
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
    );
    if (!res.ok) throw new Error(`listFiles ${res.status}: ${await res.text()}`);
    return res.json();
}

async function postComment(body) {
    const res = await api(
        `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
        }
    );
    if (!res.ok) throw new Error(`comment ${res.status}: ${await res.text()}`);
}

async function main() {
    const files = await listFiles();
    const fileLines = files
        .map((f) => `- \`${f.filename}\` (+${f.additions} / -${f.deletions})`)
        .join("\n");

    let diffText = await getDiff();
    const maxLen = 100_000;
    if (diffText.length > maxLen) {
        diffText =
            diffText.slice(0, maxLen) +
            `\n\n… *(diff truncated to ${maxLen} chars for the LLM)*`;
    }

    const provider = resolveChatProvider();
    let summaryBlock;
    if (!provider) {
        summaryBlock =
            "**LLM summary disabled:** add repository secret **`GROQ_API_KEY`**. Summaries use model **`qwen/qwen3-32b`** unless you set **`LLM_MODEL`**.\n\n";
    } else {
        try {
            const summary = await chatComplete(
                provider,
                [
                    {
                        role: "system",
                        content:
                            "You summarize Git pull request diffs for engineers. Be concise: purpose of the change, main areas touched, risks or follow-ups. Use markdown bullets. Do not invent files or changes not shown in the diff.",
                    },
                    {
                        role: "user",
                        content: `Summarize this PR diff:\n\n${diffText}`,
                    },
                ],
                { max_tokens: 1200, temperature: 0.3 }
            );
            summaryBlock = `### LLM summary (${provider.label})\n\n${summary}\n\n`;
        } catch (e) {
            summaryBlock = `### LLM summary (error)\n\n\`\`\`\n${String(e)}\n\`\`\`\n\n`;
        }
    }

    const body =
        `## PR change summary (bot)\n\n` +
        summaryBlock +
        `### Files changed\n\n${fileLines || "_none_"}\n\n` +
        "---\n*Workflow: .github/workflows/pr-llm-summary.yml — verify before merging.*";

    await postComment(body);
    console.log("Posted PR comment.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
