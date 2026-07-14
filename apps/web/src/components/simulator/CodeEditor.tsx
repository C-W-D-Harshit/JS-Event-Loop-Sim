import { useEffect, useRef, useMemo } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState, Compartment } from '@codemirror/state';
import {
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';

interface CodeEditorProps {
  code: string;
  highlightedLines: number[];
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onDiagnostics?: (diagnostics: Array<{ message: string; line?: number; column?: number }>) => void;
  className?: string;
}

export function CodeEditor({
  code,
  highlightedLines,
  readOnly = false,
  onChange,
  onDiagnostics,
  className,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const decorationCompartmentRef = useRef<Compartment | null>(null);
  const readOnlyCompartmentRef = useRef<Compartment | null>(null);
  const highlightedLinesSet = useMemo(() => new Set(highlightedLines), [highlightedLines]);
  const codeRef = useRef(code);

  const createHighlightDecorations = (view: EditorView): DecorationSet => {
    const builder: any[] = [];

    for (let line = 1; line <= view.state.doc.lines; line++) {
      if (highlightedLinesSet.has(line)) {
        const lineFrom = view.state.doc.line(line).from;
        builder.push(Decoration.line({ class: 'highlighted-line' }).range(lineFrom));
      }
    }

    return Decoration.set(builder);
  };

  const createEditor = () => {
    if (!editorRef.current || viewRef.current) return;

    const decorationCompartment = new Compartment();
    decorationCompartmentRef.current = decorationCompartment;

    const readOnlyCompartment = new Compartment();
    readOnlyCompartmentRef.current = readOnlyCompartment;

    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          keymap.of(defaultKeymap),
          autocompletion(),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '14px',
            },
            '.cm-scroller': {
              fontFamily: 'var(--font-mono), monospace',
              overflow: 'auto',
            },
            '.cm-content': {
              padding: '16px',
            },
            '.cm-gutters': {
              backgroundColor: '#1e1e1e',
              color: '#607080',
              border: 'none',
            },
            '.cm-activeLineGutter': {
              backgroundColor: '#2c313c',
              color: '#90a4ae',
            },
            '.cm-activeLine': {
              backgroundColor: 'rgba(96, 165, 250, 0.1)',
            },
            '.highlighted-line': {
              backgroundColor: 'rgba(96, 165, 250, 0.2)',
              borderLeft: '4px solid #60a5fa',
            },
          }),
          EditorView.updateListener.of((update: any) => {
            if (update.docChanged && onChange) {
              onChange(String(update.state.doc));
            }
          }),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          decorationCompartment.of(EditorView.decorations.of(createHighlightDecorations)),
        ],
      }),
      parent: editorRef.current,
    });

    viewRef.current = view;
  };

  useEffect(() => {
    createEditor();

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (viewRef.current && readOnlyCompartmentRef.current) {
      viewRef.current.dispatch({
        effects: [
          readOnlyCompartmentRef.current.reconfigure(
            EditorState.readOnly.of(readOnly)
          ),
        ],
      });
    }
  }, [readOnly]);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  useEffect(() => {
    if (!viewRef.current) return;

    const currentCode = String(viewRef.current.state.doc);
    if (currentCode !== code) {
      const transaction = viewRef.current.state.update({
        changes: { from: 0, to: currentCode.length, insert: code },
        selection: { anchor: 0 },
      });
      viewRef.current.dispatch(transaction);

      requestAnimationFrame(() => {
        if (viewRef.current) {
          viewRef.current.dispatch({
            effects: EditorView.scrollIntoView(0),
          });
        }
      });
    }
  }, [code]);

  useEffect(() => {
    if (!viewRef.current || !decorationCompartmentRef.current) return;

    viewRef.current.dispatch({
      effects: [
        decorationCompartmentRef.current.reconfigure([
          EditorView.decorations.of(createHighlightDecorations),
        ]),
      ],
    });
  }, [highlightedLinesSet]);

  return (
    <div ref={editorRef} className={className} style={{ height: '100%' }} />
  );
}
