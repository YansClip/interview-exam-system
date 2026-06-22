(function () {
  const MONACO_VERSION = "0.52.2";
  const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

  let monacoPromise = null;
  let editorInstance = null;
  let fallbackTextArea = null;
  let completionDisposable = null;
  let hostCopyHandler = null;
  let hostCutHandler = null;
  let hostPasteBlockHandler = null;
  let activeHost = null;

  window.MonacoEnvironment = {
    getWorkerUrl() {
      return `${MONACO_BASE}/base/worker/workerMain.js`;
    },
  };

  function mapLanguage(language) {
    if (language === "Python") return "python";
    if (language === "C++") return "cpp";
    if (language === "Java") return "java";
    return "plaintext";
  }

  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (monacoPromise) return monacoPromise;

    monacoPromise = new Promise((resolve, reject) => {
      if (window.require) {
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.require(["vs/editor/editor.main"], (monaco) => {
          window.monaco = monaco;
          resolve(monaco);
        }, reject);
        return;
      }

      const script = document.createElement("script");
      script.src = `${MONACO_BASE}/loader.js`;
      script.onload = () => {
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.require(["vs/editor/editor.main"], (monaco) => {
          window.monaco = monaco;
          resolve(monaco);
        }, reject);
      };
      script.onerror = () => reject(new Error("代码编辑器加载失败"));
      document.head.appendChild(script);
    });

    return monacoPromise;
  }

  function registerCompletionProviders(monaco) {
    if (completionDisposable) {
      completionDisposable.dispose();
      completionDisposable = null;
    }

    const disposables = [];

    const pythonSnippets = [
      { label: "import sys", insertText: "import sys" },
      { label: "from collections import deque", insertText: "from collections import deque" },
      { label: "from collections import defaultdict", insertText: "from collections import defaultdict" },
      { label: "input()", insertText: "input()" },
      { label: "print()", insertText: "print($0)" },
      { label: "for i in range(n)", insertText: "for i in range(${1:n}):\n    $0" },
      { label: "while True", insertText: "while True:\n    $0" },
      { label: "if __name__ == '__main__'", insertText: "if __name__ == '__main__':\n    $0" },
    ];

    const cppSnippets = [
      { label: "#include <iostream>", insertText: "#include <iostream>" },
      { label: "#include <vector>", insertText: "#include <vector>" },
      { label: "#include <queue>", insertText: "#include <queue>" },
      { label: "using namespace std;", insertText: "using namespace std;" },
      { label: "int main()", insertText: "int main() {\n    $0\n    return 0;\n}" },
      { label: "cin >>", insertText: "cin >> $0" },
      { label: "cout <<", insertText: "cout << $0 << endl;" },
    ];

    const javaSnippets = [
      { label: "import java.util.*", insertText: "import java.util.*;" },
      { label: "public class Main", insertText: "public class Main {\n    public static void main(String[] args) {\n        $0\n    }\n}" },
      { label: "Scanner", insertText: "Scanner sc = new Scanner(System.in);" },
      { label: "System.out.println", insertText: "System.out.println($0);" },
    ];

    function makeProvider(languageId, snippets) {
      return monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: [".", " ", "(", "<", "#"],
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: snippets.map((item) => ({
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: item.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
          };
        },
      });
    }

    disposables.push(makeProvider("python", pythonSnippets));
    disposables.push(makeProvider("cpp", cppSnippets));
    disposables.push(makeProvider("java", javaSnippets));

    completionDisposable = {
      dispose() {
        disposables.forEach((item) => item.dispose());
      },
    };
  }

  function trackEditorClipboard(host) {
    if (!host) return;

    hostCopyHandler = () => {
      if (!editorInstance) return;
      const model = editorInstance.getModel();
      const selection = editorInstance.getSelection();
      if (!model || !selection) return;
      window.AntiCheat?.markInternalCopy?.(model.getValueInRange(selection));
    };

    hostCutHandler = () => {
      hostCopyHandler?.();
    };

    host.addEventListener("copy", hostCopyHandler, true);
    host.addEventListener("cut", hostCutHandler, true);
  }

  function untrackEditorClipboard(host) {
    if (!host) return;
    if (hostCopyHandler) host.removeEventListener("copy", hostCopyHandler, true);
    if (hostCutHandler) host.removeEventListener("cut", hostCutHandler, true);
    if (hostPasteBlockHandler) host.removeEventListener("paste", hostPasteBlockHandler, true);
    hostCopyHandler = null;
    hostCutHandler = null;
    hostPasteBlockHandler = null;
  }

  function getEditorTheme() {
    return document.documentElement.dataset.authTheme === "dark" ? "vs-dark" : "vs";
  }

  function applyEditorTheme() {
    if (!window.monaco) return;
    window.monaco.editor.setTheme(getEditorTheme());
  }

  async function mount(host, options = {}) {
    dispose();
    let monaco;
    try {
      monaco = await loadMonaco();
    } catch (error) {
      fallbackTextArea = document.createElement("textarea");
      fallbackTextArea.className = "code-editor-fallback-input";
      fallbackTextArea.spellcheck = false;
      fallbackTextArea.value = options.value || "";
      fallbackTextArea.setAttribute("aria-label", "代码输入框");
      fallbackTextArea.addEventListener("input", () => {
        options.onChange?.(fallbackTextArea.value);
      });
      fallbackTextArea.addEventListener("paste", (event) => {
        window.AntiCheat?.tryBlockExternalPaste?.(event, "fallback_textarea");
      }, true);
      host.innerHTML = "";
      host.appendChild(fallbackTextArea);
      fallbackTextArea.focus();
      return fallbackTextArea;
    }

    registerCompletionProviders(monaco);

    editorInstance = monaco.editor.create(host, {
      value: options.value || "",
      language: mapLanguage(options.language || "Python"),
      theme: getEditorTheme(),
      automaticLayout: true,
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "off",
      tabSize: 4,
      insertSpaces: true,
      suggestOnTriggerCharacters: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      wordBasedSuggestions: "matchingDocuments",
      tabCompletion: "on",
      acceptSuggestionOnCommitCharacter: true,
      acceptSuggestionOnEnter: "on",
      snippetSuggestions: "top",
      formatOnType: true,
      autoClosingBrackets: "always",
      autoClosingQuotes: "always",
      autoIndent: "full",
      bracketPairColorization: { enabled: true },
      padding: { top: 12, bottom: 12 },
    });

    if (options.onChange) {
      editorInstance.onDidChangeModelContent(() => {
        options.onChange(editorInstance.getValue());
      });
    }

    trackEditorClipboard(host);

    hostPasteBlockHandler = (event) => {
      window.AntiCheat?.tryBlockExternalPaste?.(event, "monaco");
    };
    host.addEventListener("paste", hostPasteBlockHandler, true);

    editorInstance.onDidPaste((pasteEvent) => {
      const model = editorInstance.getModel();
      if (!model) return;
      const pastedText = model.getValueInRange(pasteEvent.range);
      if (window.AntiCheat?.isInternalPaste?.(pastedText)) return;
      editorInstance.executeEdits("antiCheat", [
        {
          range: pasteEvent.range,
          text: "",
          forceMoveMarkers: true,
        },
      ]);
    });

    activeHost = host;
    editorInstance.focus();
    return editorInstance;
  }

  function dispose() {
    if (activeHost) {
      untrackEditorClipboard(activeHost);
      activeHost = null;
    }
    if (editorInstance) {
      editorInstance.dispose();
      editorInstance = null;
    }
    if (fallbackTextArea) {
      fallbackTextArea.remove();
      fallbackTextArea = null;
    }
  }

  function getValue() {
    return editorInstance?.getValue() ?? fallbackTextArea?.value ?? "";
  }

  function setLanguage(language) {
    if (!editorInstance || !window.monaco) return;
    const model = editorInstance.getModel();
    if (model) {
      window.monaco.editor.setModelLanguage(model, mapLanguage(language));
    }
  }

  function layout() {
    editorInstance?.layout();
  }

  function focus() {
    editorInstance?.focus();
    fallbackTextArea?.focus();
  }

  window.addEventListener("auth-theme-change", applyEditorTheme);

  function setReadOnly(readOnly) {
    if (editorInstance) {
      editorInstance.updateOptions({ readOnly: Boolean(readOnly) });
    }
    if (fallbackTextArea) {
      fallbackTextArea.readOnly = Boolean(readOnly);
    }
  }

  window.CodeEditor = {
    mount,
    dispose,
    getValue,
    setLanguage,
    layout,
    focus,
    loadMonaco,
    setReadOnly,
  };
})();
