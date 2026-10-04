import type { LlmSettingsLocale } from "@tik-choco/mistai/preact";

export const aiSettingsMessages = {
  en: { defaultLabel: "Default", defaultTip: "Model for chat, review and selection translation", embeddingLabel: "Embedding", embeddingTip: "Stored for future embedding features; currently unused", modelPlaceholder: "Model ID" },
  ja: { defaultLabel: "既定", defaultTip: "チャット・レビュー・選択翻訳に使うモデル", embeddingLabel: "埋め込み", embeddingTip: "将来の埋め込み機能用の設定（現在は未使用）", modelPlaceholder: "モデルID" },
  "zh-CN": { defaultLabel: "默认", defaultTip: "用于聊天、审阅和选中文本翻译的模型", embeddingLabel: "嵌入", embeddingTip: "为未来的嵌入功能保存设置（目前未使用）", modelPlaceholder: "模型 ID" },
  "zh-TW": { defaultLabel: "預設", defaultTip: "用於聊天、審閱和選取文字翻譯的模型", embeddingLabel: "嵌入", embeddingTip: "為未來的嵌入功能儲存設定（目前未使用）", modelPlaceholder: "模型 ID" },
} satisfies Record<LlmSettingsLocale, Record<string, string>>;

export function aiSettingsLocale(language: string): LlmSettingsLocale {
  if (language === "zh" || language === "zh-CN") return "zh-CN";
  return language === "ja" || language === "zh-TW" ? language : "en";
}
