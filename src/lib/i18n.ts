// UI translation dictionary. Add one entry per user-facing string, keyed by
// a dot-namespaced id (component or module name first, e.g. "collab.leave").
// A value can be a plain string or, for strings that interpolate a value
// (counts, names, etc.), a function taking a params object — see
// "collab.peersConnected" below for the pattern.
import type { Language } from "./appSettings";
import { zh } from "./locales/zh";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { ko } from "./locales/ko";
import { pt } from "./locales/pt";

export type Params = Record<string, string | number>;
export type Entry = string | ((params: Params) => string);

const dict = {
  "appSettings.openButton": { ja: "表示設定", en: "Display settings" },
  "appSettings.title": { ja: "表示設定", en: "Display settings" },
  "appSettings.language": { ja: "言語", en: "Language" },
  "appSettings.language.ja": { ja: "日本語", en: "Japanese" },
  "appSettings.language.en": { ja: "English", en: "English" },
  "appSettings.close": { ja: "閉じる", en: "Close" },
  "appSettings.shortcuts.title": { ja: "キーボードショートカット", en: "Keyboard shortcuts" },
  "appSettings.shortcuts.newNote": { ja: "新規ノート", en: "New note" },
  "appSettings.shortcuts.search": { ja: "検索", en: "Search" },
  "appSettings.shortcuts.selectAllBlocks": { ja: "すべてのブロックを選択", en: "Select all blocks" },
  "appSettings.shortcuts.copyBlocks": { ja: "選択ブロックをコピー", en: "Copy selected blocks" },
  "appSettings.shortcuts.cutBlocks": { ja: "選択ブロックを切り取り", en: "Cut selected blocks" },
  "appSettings.shortcuts.deleteBlocks": { ja: "選択ブロックを削除", en: "Delete selected blocks" },
  "appSettings.shortcuts.deselect": { ja: "選択を解除", en: "Deselect" },

  // Unified settings modal (one gear → tabbed Display / AI sections).
  "settings.title": { ja: "設定", en: "Settings" },
  "settings.tab.display": { ja: "表示", en: "Display" },
  "settings.tab.ai": { ja: "AI", en: "AI" },

  "mermaidBlock.clickToEdit": { ja: "クリックして編集", en: "Click to edit" },
  "mermaidBlock.renderError": {
    ja: (params) => `図の描画に失敗しました: ${params.error}`,
    en: (params) => `Failed to render diagram: ${params.error}`,
  },
  "mermaidBlock.rendering": { ja: "図を描画中...", en: "Rendering diagram..." },

  "bibtexBlock.clickToEdit": { ja: "クリックして編集", en: "Click to edit" },
  "bibtexBlock.noEntries": {
    ja: "有効な文献情報が見つかりませんでした",
    en: "No entries found",
  },

  "tableBlock.deleteColumn": { ja: "この列を削除", en: "Delete this column" },
  "tableBlock.addColumn": { ja: "列を追加", en: "Add column" },
  "tableBlock.newColumnHeader": { ja: (params) => `列${params.n}`, en: (params) => `Column ${params.n}` },
  "tableBlock.deleteRow": { ja: "この行を削除", en: "Delete this row" },
  "tableBlock.addRowButton": { ja: "＋ 行を追加", en: "＋ Add row" },
  "tableBlock.editAsMarkdownTitle": { ja: "Markdownとして直接編集", en: "Edit directly as Markdown" },
  "tableBlock.editAsMarkdownButton": { ja: "Markdownを編集", en: "Edit Markdown" },

  "insertMenu.addBlock": { ja: "ブロックを追加", en: "Add block" },
  "insertMenu.h1": { ja: "見出し1", en: "Heading 1" },
  "insertMenu.h2": { ja: "見出し2", en: "Heading 2" },
  "insertMenu.h3": { ja: "見出し3", en: "Heading 3" },
  "insertMenu.bullet": { ja: "箇条書き", en: "Bulleted list" },
  "insertMenu.numbered": { ja: "番号付きリスト", en: "Numbered list" },
  "insertMenu.checklist": { ja: "チェックリスト", en: "Checklist" },
  "insertMenu.quote": { ja: "引用", en: "Quote" },
  "insertMenu.code": { ja: "コードブロック", en: "Code block" },
  "insertMenu.math": { ja: "数式 (LaTeX)", en: "Math (LaTeX)" },
  "insertMenu.table": { ja: "表", en: "Table" },
  "insertMenu.mermaid": { ja: "図(Mermaid)", en: "Diagram (Mermaid)" },
  "insertMenu.mermaidStart": { ja: "開始", en: "Start" },
  "insertMenu.mermaidDecision": { ja: "判定", en: "Decision" },
  "insertMenu.mermaidProcess": { ja: "処理", en: "Process" },
  "insertMenu.mermaidEnd": { ja: "終了", en: "End" },
  "insertMenu.hr": { ja: "区切り線", en: "Divider" },

  "statusBar.updated": { ja: (params) => `更新: ${params.time}`, en: (params) => `Updated: ${params.time}` },
  "statusBar.unsaved": { ja: "未保存", en: "Unsaved" },
  "statusBar.markdownChars": {
    ja: (params) => `Markdown ${params.count} 文字`,
    en: (params) => `Markdown ${params.count} chars`,
  },
  "statusBar.peersEditing": {
    ja: (params) => `${params.count}人が編集中`,
    en: (params) => `${params.count} people editing`,
  },

  "block.clickToEdit": { ja: "クリックして編集", en: "Click to edit" },
  "block.clickToStart": { ja: "クリックして入力を開始...", en: "Click to start typing..." },
  "block.placeholder": { ja: "入力してください...", en: "Type here..." },

  "blockEditor.insertBelow": { ja: "この下にブロックを追加", en: "Add a block below" },
  "blockEditor.addNewBlock": { ja: "新しいブロックを追加", en: "Add a new block" },
  "blockEditor.addBlockPrompt": { ja: "+ クリックして入力を追加", en: "+ Click to add text" },
  "blockEditor.dragToReorder": { ja: "ドラッグして並べ替え", en: "Drag to reorder" },
  "blockEditor.fileTooLarge": {
    ja: (params) => `"${params.name}" は大きすぎるため追加できませんでした（4MBまで）`,
    en: (params) => `"${params.name}" is too large to add (4MB max)`,
  },

  "noteList.empty": { ja: "ノートがありません", en: "No notes" },
  "noteList.favoriteToggle": { ja: "お気に入り切り替え", en: "Toggle favorite" },
  "noteList.moveToFolder": { ja: "フォルダへ移動", en: "Move to folder" },
  "noteList.unfiled": { ja: "未分類", en: "Unfiled" },
  "noteList.delete": { ja: "削除", en: "Delete" },

  "folderShare.status.idle": { ja: "このフォルダは共有中（未接続）", en: "This folder is shared (not connected)" },
  "folderShare.status.connecting": { ja: "接続中...", en: "Connecting..." },
  "folderShare.status.connected": { ja: "このフォルダは共有中（接続済み）", en: "This folder is shared (connected)" },
  "folderShare.status.error": { ja: "接続エラー", en: "Connection error" },
  "folderShare.titleActive": { ja: "このフォルダは共有中", en: "This folder is shared" },
  "folderShare.titleInactive": { ja: "フォルダを共有", en: "Share folder" },
  "folderShare.ariaLabel": { ja: "フォルダの共有設定", en: "Folder sharing settings" },
  "folderShare.copyRoomId": { ja: "ルームIDをコピー", en: "Copy room ID" },
  "folderShare.disable": { ja: "共有を解除", en: "Stop sharing" },
  "folderShare.generateNew": { ja: "新しいルームで共有", en: "Share with a new room" },
  "folderShare.joinPlaceholder": { ja: "既存のルームIDを入力", en: "Enter an existing room ID" },
  "folderShare.joinSubmit": { ja: "このルームで共有", en: "Share with this room" },
  "folderShare.invalidRoomId": { ja: "ルームIDが正しくありません", en: "The room ID is invalid" },
  "folderShare.disableConfirm": { ja: "このフォルダの共有を解除しますか？", en: "Stop sharing this folder?" },

  "import.noContent": {
    ja: "インポートできる内容が見つかりませんでした",
    en: "No importable content was found",
  },
  "import.unsupportedFormat": {
    ja: "対応していないファイル形式です(.md のみインポートできます)",
    en: "Unsupported file format (only .md files can be imported)",
  },

  // The toolbar icon only opens the collab menu (an explicit button inside
  // starts sharing), so the idle label must not promise "start".
  "collabButton.status.idle": { ja: "共同編集", en: "Collaboration" },
  "collabButton.status.connecting": { ja: "接続中...", en: "Connecting..." },
  "collabButton.status.connected": { ja: "共同編集中", en: "Collaborating" },
  "collabButton.status.error": { ja: "接続エラー", en: "Connection error" },
  "collabButton.peersConnected": {
    ja: (params) => `${params.count}人が接続中`,
    en: (params) => `${params.count} people connected`,
  },
  "collabButton.overflowPeers": {
    ja: (params) => `他${params.count}人`,
    en: (params) => `+${params.count} more`,
  },
  "collabButton.folderShared": { ja: "📁 このフォルダは共有中", en: "📁 This folder is shared" },
  "collabButton.copyLink": { ja: "リンクをコピー", en: "Copy link" },
  "collabButton.noPeersYet": { ja: "まだ他の参加者はいません", en: "No other participants yet" },
  "collabButton.leaveConfirm": { ja: "共同編集を終了しますか？", en: "End collaboration?" },
  "collabButton.leaveButton": { ja: "共同編集を終了", en: "End collaboration" },
  "collabButton.joinPlaceholder": { ja: "ルームIDを入力して参加", en: "Enter a room ID to join" },
  "collabButton.joinSubmit": { ja: "ルームに参加", en: "Join room" },
  "collabButton.displayName": { ja: "表示名", en: "Display name" },
  "collabButton.cursorColor": { ja: "カーソルの色", en: "Cursor color" },

  "collab.startSharing": { ja: "共有を開始", en: "Start sharing" },

  "sidebar.newNote": { ja: "新規ノート", en: "New note" },
  "sidebar.newNoteInFolder": { ja: "このフォルダにノートを追加", en: "Add a note to this folder" },
  "sidebar.import": { ja: "ファイルをインポート", en: "Import file" },
  // Honest about scope: the filter only sees titles + short previews, not
  // full note bodies (those live behind async wasm storage — see mistlib).
  "sidebar.searchPlaceholder": { ja: "タイトルを検索", en: "Search titles" },
  "sidebar.searchTitle": { ja: "検索 (Ctrl+K)", en: "Search (Ctrl+K)" },
  "sidebar.searchAriaLabel": { ja: "検索", en: "Search" },
  "sidebar.emptyHint": {
    ja: "＋ ボタンから最初のノートを作成しましょう",
    en: "Create your first note with the + button",
  },
  "sidebar.favorites": { ja: "★ お気に入り", en: "★ Favorites" },
  "sidebar.notebooks": { ja: "ノートブック", en: "Notebooks" },
  "sidebar.addFolder": { ja: "フォルダを追加", en: "Add folder" },
  "sidebar.newFolderPlaceholder": { ja: "フォルダ名を入力してEnter", en: "Enter a folder name and press Enter" },
  "sidebar.deleteFolder": { ja: "フォルダを削除", en: "Delete folder" },
  "sidebar.unfiledSection": { ja: "未分類", en: "Unfiled" },

  // Global full-text search (Ctrl+Shift+F) — a command-palette that searches
  // note titles AND bodies, distinct from the sidebar's title-only filter.
  "globalSearch.title": { ja: "全体検索", en: "Search notes" },
  "globalSearch.placeholder": { ja: "すべてのノートを全文検索…", en: "Search all notes…" },
  "globalSearch.ariaLabel": { ja: "すべてのノートを検索", en: "Search all notes" },
  "globalSearch.openAriaLabel": { ja: "ノートを開く", en: "Open note" },
  "globalSearch.loading": { ja: "ノートを読み込み中…", en: "Loading notes…" },
  "globalSearch.empty": { ja: "一致するノートがありません", en: "No matching notes" },
  "globalSearch.recent": { ja: "最近のノート", en: "Recent notes" },
  "globalSearch.resultCount": {
    ja: (params) => `${params.count}件の結果`,
    en: (params) => `${params.count} ${params.count === 1 ? "result" : "results"}`,
  },
  "globalSearch.hint": {
    ja: "上下の矢印キーで結果を移動し、Enterで開き、Escで閉じます。",
    en: "Use the up and down arrow keys to move between results, Enter to open, and Escape to close.",
  },
  "globalSearch.footerNavigate": { ja: "移動", en: "Navigate" },
  "globalSearch.footerOpen": { ja: "開く", en: "Open" },
  "globalSearch.footerClose": { ja: "閉じる", en: "Close" },

  "llmSettings.title": { ja: "LLM プロバイダー設定", en: "LLM provider settings" },
  "llmSettings.close": { ja: "閉じる", en: "Close" },
  "llmSettings.providersLabel": { ja: "プロバイダー", en: "Providers" },
  "llmSettings.addProvider": { ja: "プロバイダーを追加", en: "Add provider" },
  "llmSettings.edit": { ja: "編集", en: "Edit" },
  "llmSettings.delete": { ja: "削除", en: "Delete" },
  "llmSettings.noProviders": { ja: "プロバイダーが登録されていません", en: "No providers registered" },
  "llmSettings.labelPlaceholder": { ja: "ラベル (例: OpenAI)", en: "Label (e.g. OpenAI)" },
  "llmSettings.baseUrlPlaceholder": {
    ja: "ベースURL (例: https://api.openai.com/v1)",
    en: "Base URL (e.g. https://api.openai.com/v1)",
  },
  "llmSettings.apiKeyPlaceholder": { ja: "APIキー", en: "API key" },
  "llmSettings.save": { ja: "保存", en: "Save" },
  "llmSettings.cancel": { ja: "キャンセル", en: "Cancel" },
  "llmSettings.fetchModels": { ja: "モデル一覧を取得", en: "Fetch model list" },
  "llmSettings.fetchingModels": { ja: "取得中...", en: "Fetching..." },
  "llmSettings.fetchModelsError": { ja: "モデル一覧の取得に失敗しました", en: "Failed to fetch the model list" },
  "llmSettings.llmModelLabel": { ja: "LLMモデル", en: "LLM model" },
  "llmSettings.selectPlaceholder": { ja: "選択してください", en: "Please select" },
  "llmSettings.notInList": {
    ja: (params) => `${params.model} (一覧にありません)`,
    en: (params) => `${params.model} (not in list)`,
  },
  "llmSettings.embeddingModelLabel": { ja: "Text Embeddingモデル", en: "Text embedding model" },
  "llmSettings.modelIdPlaceholder": { ja: "モデルIDを入力", en: "Enter a model ID" },

  "llmSettings.presetsLabel": { ja: "プリセット", en: "Presets" },
  "llmSettings.addPreset": { ja: "プリセットを追加", en: "Add preset" },
  "llmSettings.noPresets": { ja: "プリセットが登録されていません", en: "No presets registered" },
  "llmSettings.noProvidersForPreset": {
    ja: "先にプロバイダーを追加してください",
    en: "Add a provider first",
  },
  "llmSettings.presetLabelPlaceholder": { ja: "ラベル (例: 高速応答)", en: "Label (e.g. Fast reply)" },
  "llmSettings.presetProviderLabel": { ja: "プロバイダー", en: "Provider" },
  "llmSettings.temperatureLabel": { ja: "Temperature (任意)", en: "Temperature (optional)" },
  "llmSettings.temperaturePlaceholder": { ja: "例: 0.7", en: "e.g. 0.7" },
  "llmSettings.reasoningEffortLabel": { ja: "Reasoning effort (任意)", en: "Reasoning effort (optional)" },
  "llmSettings.reasoningEffortPlaceholder": { ja: "例: medium", en: "e.g. medium" },
  "llmSettings.defaultPresetHint": {
    ja: "既定として使うプリセットを選択してください。",
    en: "Choose which preset to use by default.",
  },
  "llmSettings.unknownProvider": { ja: "(不明なプロバイダー)", en: "(unknown provider)" },

  "llmSettings.networkSection": { ja: "AI Network", en: "AI Network" },
  "llmSettings.networkTransportNote": {
    ja: "AI Network は、参加中の共有ルームを通信経路として利用します（共有ページの機能とは別のものです）。",
    en: "The AI Network uses the joined collaboration room as its transport (it is separate from page sharing itself).",
  },
  "llmSettings.connectionLabel": { ja: "接続方法", en: "Connection" },
  "llmSettings.connection.api": { ja: "APIに直接接続", en: "Direct API" },
  "llmSettings.connection.network": { ja: "AI Network のプロバイダーを利用", en: "Use an AI Network provider" },
  "llmSettings.connection.networkHint": {
    ja: "AI Network を使うには共有ルームに参加してください。ルーム内のプロバイダーがリクエストを処理します。",
    en: "Join a collaboration room to use the AI Network. A provider in the room handles your requests.",
  },
  // --- New in this change: dedicated AI Network room, usable without a collab session ---
  "llmSettings.networkRoomIdLabel": { ja: "ルームID", en: "Room ID" },
  "llmSettings.networkRoomIdPlaceholder": {
    ja: "専用のAI NetworkルームID（任意）",
    en: "Dedicated AI Network room ID (optional)",
  },
  "llmSettings.networkRoomIdHint": {
    ja: "ルームIDを設定すると、共有ルームに参加していなくてもAI Networkを利用できます。共有ルームに参加中はそちらが優先されます。",
    en: "Set a Room ID to use the AI Network without joining a collaboration room. While a collaboration room is joined, it takes priority over this room.",
  },
  "llmSettings.networkRoomIdConnectError": {
    ja: "AI Networkルームに接続できませんでした。ルームIDを確認してください。",
    en: "Couldn't connect to the AI Network room. Check the Room ID and try again.",
  },
  // --- End new keys ---
  "llmSettings.providerModeLabel": { ja: "プロバイダーとして提供", en: "Serve as a provider" },
  "llmSettings.providerModeHint": {
    ja: "有効にすると、同じルームの他の参加者のリクエストを、あなたのAPIキーで処理します。",
    en: "When enabled, other participants in the same room can send requests that are handled with your API key.",
  },
  "llmSettings.providerModeNeedsProvider": {
    ja: "先にプロバイダーとLLMモデルを設定してください。",
    en: "Configure a provider and an LLM model first.",
  },

  "llmChat.title": { ja: "アシスタント", en: "Assistant" },
  "llmChat.close": { ja: "閉じる", en: "Close" },
  "llmChat.toggle": { ja: "アシスタントとチャット", en: "Chat with the assistant" },
  "llmChat.empty": {
    ja: "このノートについて質問してみましょう。",
    en: "Ask a question about this note.",
  },
  "llmChat.placeholder": { ja: "メッセージを入力...", en: "Type a message..." },
  "llmChat.send": { ja: "送信", en: "Send" },
  "llmChat.thinking": { ja: "考え中...", en: "Thinking..." },
  "llmChat.includeContext": { ja: "このノートの内容を含める", en: "Include this note's content" },
  "llmChat.contextPrefix": {
    ja: "以下は現在編集中のノートの内容です。これを踏まえて回答してください。",
    en: "The following is the note the user is currently editing. Use it as context for your answers.",
  },
  "llmChat.transport.api": { ja: "API", en: "API" },
  "llmChat.providerServingHint": {
    ja: "このデバイスはルーム内の他の参加者にLLMを提供しています。",
    en: "This device is serving the LLM to other participants in the room.",
  },
  "llmChat.hint.needRoom": {
    ja: "LLMネットワークを使うには共同編集ルームに参加してください。",
    en: "Join a collaboration room to use the LLM network.",
  },
  "llmChat.hint.needProvider": {
    ja: "LLMプロバイダーを設定してください。",
    en: "Configure an LLM provider first.",
  },
  "llmChat.hint.searchingProvider": {
    ja: "ルーム内にプロバイダーが見つかりません。誰かがプロバイダーとして提供を有効にすると利用できます。",
    en: "No provider found in this room yet. Chat becomes available once someone serves as a provider.",
  },

  "editorToolbar.chatTitle": { ja: "アシスタント", en: "Assistant" },
  "editorToolbar.reviewTitle": { ja: "レビュー", en: "Review" },

  "reviewPanel.title": { ja: "レビュー", en: "Review" },
  "reviewPanel.close": { ja: "閉じる", en: "Close" },
  "reviewPanel.runButton": { ja: "レビューを実行", en: "Run review" },
  "reviewPanel.running": { ja: "実行中...", en: "Running..." },
  "reviewPanel.overallScore": { ja: "総合スコア", en: "Overall score" },
  "reviewPanel.summary": { ja: "総評", en: "Summary" },
  "reviewPanel.parseError": {
    ja: "レビュー結果の解析に失敗しました。",
    en: "Failed to parse the review response.",
  },
  "reviewPanel.rawResponse": { ja: "受信した生の応答を表示", en: "Show raw response" },
  "reviewPanel.criterion.technicalContent": { ja: "技術的内容", en: "Technical Content" },
  "reviewPanel.criterion.originality": { ja: "独創性", en: "Originality" },
  "reviewPanel.criterion.clarity": { ja: "明瞭さ", en: "Clarity" },
  "reviewPanel.criterion.significance": { ja: "重要性", en: "Significance" },
  "reviewPanel.criterion.presentationStyle": { ja: "表現・体裁", en: "Presentation Style" },
  "reviewPanel.consistency.title": { ja: "整合性チェック", en: "Consistency check" },
  "reviewPanel.consistency.empty": {
    ja: "重複または類似した文は見つかりませんでした。",
    en: "No duplicate or near-duplicate sentences found.",
  },
  "reviewPanel.consistency.pairLabel": {
    ja: (params) => `ブロック ${params.a} と ブロック ${params.b}`,
    en: (params) => `Block ${params.a} and block ${params.b}`,
  },
  "reviewPanel.judge.title": { ja: "AIによる評価", en: "AI evaluation" },
  "reviewPanel.hint.needRoom": {
    ja: "LLMネットワークを使うには共同編集ルームに参加してください。",
    en: "Join a collaboration room to use the LLM network.",
  },
  "reviewPanel.hint.needProvider": {
    ja: "LLMプロバイダーを設定してください。",
    en: "Configure an LLM provider first.",
  },
  "reviewPanel.hint.searchingProvider": {
    ja: "ルーム内にプロバイダーが見つかりません。誰かがプロバイダーとして提供を有効にすると利用できます。",
    en: "No provider found in this room yet. Review becomes available once someone serves as a provider.",
  },

  // --- Review: multi-rubric generalization (new keys; keep this block
  // grouped together here to minimize merge conflicts with concurrent i18n
  // edits elsewhere in this file) ---
  "reviewPanel.rerunButton": { ja: "レビューを再実行", en: "Re-run review" },
  "reviewPanel.rubric.label": { ja: "レビューの観点", en: "Rubric" },
  "reviewPanel.rubric.research": { ja: "研究論文", en: "Research paper" },
  "reviewPanel.rubric.article": { ja: "記事・ブログ", en: "Article / blog" },
  "reviewPanel.rubric.docs": { ja: "技術文書", en: "Technical docs" },
  "reviewPanel.rubric.general": { ja: "一般文章", en: "General writing" },
  "reviewPanel.criterion.hookEngagement": { ja: "つかみ・引き込み", en: "Hook & Engagement" },
  "reviewPanel.criterion.structure": { ja: "構成", en: "Structure" },
  "reviewPanel.criterion.accuracySupport": { ja: "正確性・裏付け", en: "Accuracy & Support" },
  "reviewPanel.criterion.style": { ja: "文体", en: "Style" },
  "reviewPanel.criterion.accuracy": { ja: "正確性", en: "Accuracy" },
  "reviewPanel.criterion.completeness": { ja: "網羅性", en: "Completeness" },
  "reviewPanel.criterion.examples": { ja: "具体例", en: "Examples" },
  "reviewPanel.criterion.coherence": { ja: "一貫性", en: "Coherence" },
  "reviewPanel.criterion.tone": { ja: "トーン", en: "Tone" },
  "reviewPanel.criterion.polish": { ja: "仕上がり", en: "Polish" },
  "reviewPanel.generating": { ja: "生成中", en: "Generating" },
  "reviewPanel.streamedChars": {
    ja: (params) => `${params.count} 文字受信`,
    en: (params) => `${params.count} chars received`,
  },
  "reviewPanel.consistency.toggle": { ja: "検出された文", en: "Matches found" },
  // --- end Review new keys ---

  "toast.undo": { ja: "元に戻す", en: "Undo" },
  "toast.close": { ja: "閉じる", en: "Close" },

  "outlinePanel.heading": { ja: "アウトライン", en: "Outline" },
  "outlinePanel.empty": { ja: "見出しがありません", en: "No headings" },
  "outlinePanel.untitledHeading": { ja: "(無題の見出し)", en: "(Untitled heading)" },

  "outline.toggle": { ja: "アウトライン", en: "Outline" },

  "pageTitle.placeholder": { ja: "無題", en: "Untitled" },

  "editorToolbar.toggleSidebar.show": { ja: "サイドバーを表示", en: "Show sidebar" },
  "editorToolbar.toggleSidebar.hide": { ja: "サイドバーを隠す", en: "Hide sidebar" },
  "editorToolbar.toggleSidebarAriaLabel": { ja: "サイドバーの表示切り替え", en: "Toggle sidebar visibility" },
  "editorToolbar.favoriteToggle": { ja: "お気に入り切り替え", en: "Toggle favorite" },
  "editorToolbar.themeToggle.toDark": { ja: "ダークテーマに切り替え", en: "Switch to dark theme" },
  "editorToolbar.themeToggle.toLight": { ja: "ライトテーマに切り替え", en: "Switch to light theme" },
  "editorToolbar.llmSettingsTitle": { ja: "LLM設定", en: "LLM settings" },
  "editorToolbar.status.saving": { ja: "保存中...", en: "Saving..." },
  "editorToolbar.status.loading": { ja: "読み込み中...", en: "Loading..." },
  "editorToolbar.status.saved": { ja: "保存済み", en: "Saved" },
  "editorToolbar.status.saveError": {
    ja: (params) => `保存失敗: ${params.detail}`,
    en: (params) => `Save failed: ${params.detail}`,
  },
  "editorToolbar.status.loadError": {
    ja: (params) => `読み込み失敗: ${params.detail}`,
    en: (params) => `Failed to load: ${params.detail}`,
  },

  "app.roomContentReplaced": { ja: "共有ルームの内容を読み込みました", en: "Loaded the shared room's content" },
  "app.joinRoomFailed": { ja: "共有ルームに接続できませんでした", en: "Could not join the shared room" },
  "app.blocksDeleted": {
    ja: (params) => `${params.count}個のブロックを削除しました`,
    en: (params) => `Deleted ${params.count} block(s)`,
  },
  "app.folderDeleted": {
    ja: (params) => `フォルダ「${params.name}」を削除しました`,
    en: (params) => `Deleted folder "${params.name}"`,
  },
  "app.noteDeleted": {
    ja: (params) => `「${params.name}」を削除しました`,
    en: (params) => `Deleted "${params.name}"`,
  },
  "app.notesImported": {
    ja: (params) => `${params.count}件のノートを作成しました`,
    en: (params) => `Created ${params.count} note(s)`,
  },
  "app.notesAutoImported": {
    ja: (params) => `${params.count} 件のノートを自動追加しました`,
    en: (params) => `${params.count} note(s) added automatically`,
  },
  "app.translationHistoryImported": {
    ja: (params) => `${params.imported}件インポート / ${params.skipped}件スキップしました`,
    en: (params) => `Imported ${params.imported} / skipped ${params.skipped}`,
  },
  "app.translationHistoryImportFailed": {
    ja: "翻訳履歴のインポートに失敗しました",
    en: "Failed to import translation history",
  },

  "useCollab.guestName": { ja: (params) => `ゲスト${params.n}`, en: (params) => `Guest${params.n}` },
  "useCollab.invalidRoomId": { ja: "ルームIDが正しくありません", en: "The room ID is invalid" },

  // Floating popover shown when selecting text in a rendered (non-editing)
  // block — speaker/TTS button plus an auto-fetched translation (and, for
  // CJK text, a ruby reading). See TranslateHoverLayer.tsx.
  "translatePopover.loading": { ja: "翻訳中...", en: "Translating..." },
  "translatePopover.unavailable": { ja: "翻訳を利用できません", en: "Translation unavailable" },
  "translatePopover.error": { ja: "翻訳に失敗しました", en: "Couldn't translate" },
  "translatePopover.listen": { ja: "読み上げ", en: "Listen" },

  // --- note-article share (tc-chat handoff via the shared bus) ---
  "editorToolbar.shareArticle": { ja: "tc-chatへ記事として共有", en: "Share to tc-chat as article" },
  "app.articleShared": { ja: "tc-chatへ記事として共有しました", en: "Shared the note to tc-chat as an article" },
  "app.articleShareFailed": { ja: "tc-chatへの共有に失敗しました", en: "Failed to share the note to tc-chat" },
  // --- end note-article share ---

  // --- shortcuts modal ---
  "shortcutsModal.title": { ja: "キーボードショートカット", en: "Keyboard shortcuts" },
  "shortcutsModal.openButton": { ja: "キーボードショートカットを表示", en: "Show keyboard shortcuts" },
  "shortcutsModal.group.global": { ja: "全般", en: "Global" },
  "shortcutsModal.group.blocks": { ja: "ブロック選択", en: "Blocks" },
  "shortcutsModal.group.editing": { ja: "編集", en: "Editing" },
  "shortcutsModal.globalSearch": { ja: "全文検索", en: "Full-text search" },
  "shortcutsModal.toggle": { ja: "このショートカット一覧を表示", en: "Show this shortcuts list" },
  "shortcutsModal.shiftClick": { ja: "クリックで選択範囲を拡張", en: "Extend selection by clicking" },
  "shortcutsModal.shiftArrows": { ja: "選択範囲を拡張", en: "Extend selection" },
  "shortcutsModal.slashMenu": { ja: "空のブロックの先頭で挿入メニューを開く", en: "Open insert menu at the start of an empty block" },
  "shortcutsModal.splitBlock": { ja: "カーソル位置でブロックを分割", en: "Split the block at the cursor" },
  // --- note row actions menu ---
  "noteList.moreActions": { ja: "その他の操作", en: "More actions" },
  // --- sidebar resize ---
  "sidebar.resizeHandle": { ja: "サイドバーの幅を変更", en: "Resize sidebar" },

  // --- onboarding (settings) ---
  "settingsOnboarding.label": { ja: "セットアップガイド", en: "Setup guide" },
  "settingsOnboarding.description": {
    ja: "初回起動時のセットアップ案内をもう一度表示します。",
    en: "Show the first-run setup guide again.",
  },
  "settingsOnboarding.button": { ja: "ガイドを表示", en: "Show guide" },
  // --- onboarding (wizard) ---
  "onboarding.dialogLabel": { ja: "はじめてのセットアップ", en: "First-run setup" },
  "onboarding.close": { ja: "閉じる", en: "Close" },
  "onboarding.back": { ja: "戻る", en: "Back" },
  "onboarding.start": { ja: "はじめる", en: "Get started" },
  "onboarding.skip": { ja: "スキップ", en: "Skip" },
  "onboarding.done": { ja: "完了", en: "Done" },
  "onboarding.welcome.title": { ja: "TC Note へようこそ！", en: "Welcome to TC Note!" },
  "onboarding.welcome.body1": {
    ja: "TC Note は、ブロック単位で書けるMarkdownノートアプリです。複数人でのリアルタイム共同編集にも対応しています。",
    en: "TC Note is a block-based Markdown note app with real-time collaborative editing.",
  },
  "onboarding.welcome.body2": {
    ja: "この簡単なセットアップでは、任意のAI（LLM）接続と主な機能のツアーをご案内します。どちらもあとから設定画面でいつでも変更できます。",
    en: "This quick setup covers an optional AI (LLM) connection and a short tour of the main features — both are changeable anytime later in Settings.",
  },
  "onboarding.llm.title": { ja: "LLMの接続設定", en: "LLM connection" },
  "onboarding.llm.intro": {
    ja: "ノートについてAIチャットやAIレビューを使う場合に設定します。OpenAI互換のAPIならどれでも使えます（OpenAI、LM Studio、Ollamaなど）。あとからでも設定できるので、いつでもスキップできます。",
    en: "Set this up if you want to use AI chat or AI review on your notes. Any OpenAI-compatible API works (OpenAI, LM Studio, Ollama, and more). You can always configure this later, so feel free to skip.",
  },
  "onboarding.llm.baseUrlLabel": { ja: "ベースURL", en: "Base URL" },
  "onboarding.llm.baseUrlPlaceholder": { ja: "例: https://api.openai.com/v1", en: "e.g. https://api.openai.com/v1" },
  "onboarding.llm.apiKeyLabel": { ja: "APIキー（不要なら空欄）", en: "API key (leave blank if not needed)" },
  "onboarding.llm.apiKeyPlaceholder": { ja: "sk-...", en: "sk-..." },
  "onboarding.llm.modelLabel": { ja: "モデル", en: "Model" },
  "onboarding.llm.modelPlaceholder": { ja: "例: gpt-4o-mini", en: "e.g. gpt-4o-mini" },
  "onboarding.llm.providerLabel": { ja: "既定のプロバイダー", en: "Default provider" },
  "onboarding.llm.test": { ja: "接続テスト", en: "Test connection" },
  "onboarding.llm.testing": { ja: "接続中...", en: "Connecting..." },
  "onboarding.llm.testOk": { ja: "接続できました！", en: "Connected successfully!" },
  "onboarding.llm.testError": {
    ja: (params) => `接続に失敗しました: ${params.detail}`,
    en: (params) => `Connection failed: ${params.detail}`,
  },
  "onboarding.llm.testPrompt": {
    ja: "接続テストです。「OK」とだけ返してください。",
    en: 'This is a connection test. Please reply with just "OK".',
  },
  "onboarding.llm.saveNext": { ja: "保存して次へ", en: "Save and continue" },
  "onboarding.tour.title": { ja: "準備完了です！", en: "You're all set!" },
  "onboarding.tour.closing": {
    ja: "編集はすべて自動保存されます。それでは、楽しんでください！",
    en: "Everything you write is saved automatically. Enjoy TC Note!",
  },
  "onboarding.feature.editor.title": { ja: "ブロックエディタ", en: "Block editor" },
  "onboarding.feature.editor.desc": {
    ja: "「/」でスラッシュコマンドメニューを開いて挿入、ドラッグハンドルでブロックを並べ替えられます",
    en: "Insert blocks via the “/” slash-command menu, and reorder them by dragging the handle",
  },
  "onboarding.feature.outline.title": { ja: "アウトライン", en: "Outline" },
  "onboarding.feature.outline.desc": {
    ja: "見出しの階層をサイドに表示し、クリックでその場所へジャンプできます",
    en: "Shows your heading hierarchy in a side rail — click any item to jump there",
  },
  "onboarding.feature.collab.title": { ja: "共同編集と共有", en: "Collaboration & sharing" },
  "onboarding.feature.collab.desc": {
    ja: "複数人でリアルタイムに同じノートを編集したり、フォルダごと共有したりできます",
    en: "Edit the same note together in real time, or share a whole folder with others",
  },
  "onboarding.feature.ai.title": { ja: "AIチャット・AIレビュー", en: "AI chat & AI review" },
  "onboarding.feature.ai.desc": {
    ja: "ノートの内容についてAIに質問したり、内容をレビューしてもらったりできます",
    en: "Ask the AI about your note's content, or have it review what you've written",
  },
  "onboarding.feature.translate.title": { ja: "選択範囲の翻訳", en: "Translate on selection" },
  "onboarding.feature.translate.desc": {
    ja: "テキストを選択すると翻訳と読み上げがポップアップで表示されます",
    en: "Select any text to see a popup translation, with a listen button for playback",
  },

  // --- reviewPanel.queue (AI queue) ---
  "reviewPanel.queue.queued": { ja: "順番待ち", en: "Queued" },
  "reviewPanel.queue.cancel": { ja: "レビューを中止", en: "Cancel review" },
  // --- llmChat.queue (AI queue) ---
  "llmChat.queue.stop": { ja: "停止", en: "Stop" },
  "llmChat.queue.cancelled": { ja: "（停止しました）", en: "(stopped)" },
  // --- end llmChat.queue (AI queue) ---
  // --- aiQueue (AI queue indicator) ---
  "aiQueue.title": { ja: "AIタスク", en: "AI tasks" },
  "aiQueue.pendingCount": {
    ja: (params) => `保留中のタスク${params.count}件`,
    en: (params) => `${params.count} tasks pending`,
  },
  "aiQueue.kind.review": { ja: "レビュー", en: "Review" },
  "aiQueue.kind.chat": { ja: "チャット", en: "Chat" },
  "aiQueue.status.queued": { ja: "待機中", en: "Queued" },
  "aiQueue.status.running": { ja: "実行中", en: "Running" },
  "aiQueue.status.cancelling": { ja: "キャンセル中", en: "Cancelling" },
  "aiQueue.status.complete": { ja: "完了", en: "Complete" },
  "aiQueue.status.failed": { ja: "失敗", en: "Failed" },
  "aiQueue.status.cancelled": { ja: "キャンセル済み", en: "Cancelled" },
  "aiQueue.cancel": { ja: "タスクをキャンセル", en: "Cancel task" },
  "aiQueue.dismiss": { ja: "閉じる", en: "Dismiss" },
  "aiQueue.streamedChars": {
    ja: (params) => `${params.count}文字受信`,
    en: (params) => `${params.count} chars received`,
  },
  // --- end aiQueue ---
} satisfies Record<string, { ja: Entry; en: Entry }>;

export type TranslationKey = keyof typeof dict;

/** Every translation key. Used by the i18n coverage test (asserts each added
 * language translates all of them) and any locale tooling. */
export const translationKeys = Object.keys(dict) as TranslationKey[];

// Languages beyond the en/ja base layer on top as partial maps: any key a
// locale hasn't translated falls back to English, so a gap degrades to a
// readable string instead of a blank. The base (en/ja) is always complete —
// the `satisfies` above enforces it — so English is a guaranteed fallback.
const overrides: Partial<Record<Language, Partial<Record<TranslationKey, Entry>>>> = {
  zh,
  es,
  fr,
  de,
  ko,
  pt,
};

export function translate(lang: Language, key: TranslationKey, params?: Params): string {
  const base = dict[key];
  let entry: Entry;
  if (lang === "ja") entry = base.ja;
  else if (lang === "en") entry = base.en;
  else entry = overrides[lang]?.[key] ?? base.en;
  return typeof entry === "function" ? entry(params ?? {}) : entry;
}
