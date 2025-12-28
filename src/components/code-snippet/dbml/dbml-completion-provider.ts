import type { Monaco } from '@monaco-editor/react';
import type { IDisposable } from 'monaco-editor';
import { dataTypes } from '@/lib/data/data-types/data-types';

/**
 * Creates and manages a DBML completion provider.
 */
export interface DBMLCompletionManager {
    /** Disposable to clean up the completion provider registration */
    dispose: () => void;
    /** Update the compiler with new DBML content (noop for now) */
    updateSource: (content: string) => void;
}

/**
 * Registers a DBML completion provider with Monaco editor.
 *
 * Provides:
 * - Keyword suggestions (Table, Ref, Enum, etc.)
 * - Field setting suggestions (pk, not null, unique, etc.)
 * - Data type suggestions
 *
 * @param monaco - Monaco editor instance
 * @returns Manager object with dispose and updateSource methods
 */
export function registerDBMLCompletionProvider(
    monaco: Monaco
): DBMLCompletionManager {
    const keywords = [
        'Table',
        'Ref',
        'Enum',
        'Indexes',
        'Note',
        'Project',
        'TableGroup',
    ];

    const settings = [
        'primary key',
        'pk',
        'not null',
        'null',
        'unique',
        'default',
        'increment',
        'note',
        'ref',
    ];

    const types = dataTypes.map((dt) => dt.name);

    // Register with Monaco
    const disposable: IDisposable =
        monaco.languages.registerCompletionItemProvider('dbml', {
            provideCompletionItems: (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                // Extract all unique words from the document
                const text = model.getValue();
                const uniqueWords = new Set<string>(
                    text.match(/[a-zA-Z_]\w*/g) || []
                );

                // Filter out words that are already keywords, settings, or types to avoid duplicates
                const existingLabels = new Set([
                    ...keywords,
                    ...settings,
                    ...types,
                ]);

                const wordSuggestions = Array.from(uniqueWords)
                    .filter((w) => !existingLabels.has(w) && w.length > 1)
                    .map((w) => ({
                        label: w,
                        kind: monaco.languages.CompletionItemKind.Text,
                        insertText: w,
                        range: range,
                    }));

                const suggestions = [
                    ...keywords.map((k) => ({
                        label: k,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: k,
                        range: range,
                    })),
                    ...settings.map((s) => ({
                        label: s,
                        kind: monaco.languages.CompletionItemKind.Property,
                        insertText: s,
                        range: range,
                    })),
                    ...types.map((t) => ({
                        label: t,
                        kind: monaco.languages.CompletionItemKind.TypeParameter,
                        insertText: t,
                        range: range,
                    })),
                    ...wordSuggestions,
                ];

                return {
                    suggestions: suggestions,
                };
            },
        });

    return {
        dispose: () => disposable.dispose(),
        updateSource: () => {
            // No-op for manual provider
        },
    };
}
