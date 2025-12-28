// Utilities for extracting and merging DBML comments and preserving table order
// Comments in DBML can be:
// - Single line: // comment
// - Multi-line: /* comment */

interface DBMLComment {
    type: 'header' | 'table' | 'field' | 'footer' | 'inline';
    text: string;
    context?: {
        tableName?: string;
        fieldName?: string;
    };
}

interface DBMLTableOrder {
    tableName: string;
    schemaName?: string;
}

/**
 * Extract the order of tables from DBML source
 */
export function extractTableOrder(dbml: string): DBMLTableOrder[] {
    const tableOrder: DBMLTableOrder[] = [];
    const lines = dbml.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Match table definitions: Table "schema"."name" or Table name
        const tableMatch = trimmedLine.match(
            /^Table\s+(?:"([^"]+)"\.)?(?:"([^"]+)"|(\w+))/i
        );

        if (tableMatch) {
            const schemaName = tableMatch[1];
            const tableName = tableMatch[2] || tableMatch[3] || '';

            tableOrder.push({
                tableName,
                schemaName,
            });
        }
    }

    return tableOrder;
}

/**
 * Extract all comments from DBML source with their context
 */
export function extractComments(dbml: string): DBMLComment[] {
    const comments: DBMLComment[] = [];
    const lines = dbml.split('\n');

    let currentTable: string | null = null;
    let inTableBlock = false;
    let braceDepth = 0;
    let foundFirstDefinition = false;
    let pendingComments: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Track brace depth for table blocks
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;

        // Check if this line starts a table definition
        const tableMatch = trimmedLine.match(
            /^Table\s+(?:"([^"]+)"\.)?(?:"([^"]+)"|(\w+))/i
        );
        if (tableMatch) {
            currentTable =
                tableMatch[2] || tableMatch[3] || tableMatch[1] || '';
            inTableBlock = true;

            // Handle pending comments
            if (pendingComments.length > 0) {
                if (!foundFirstDefinition) {
                    // Comments before the first definition are header comments
                    comments.push({
                        type: 'header',
                        text: pendingComments.join('\n'),
                    });
                } else {
                    // Comments between definitions belong to the next table
                    comments.push({
                        type: 'table',
                        text: pendingComments.join('\n'),
                        context: { tableName: currentTable },
                    });
                }
                pendingComments = [];
            }
            foundFirstDefinition = true;
        }

        // Check if this line starts an Enum definition
        const enumMatch = trimmedLine.match(/^Enum\s+/i);
        if (enumMatch) {
            foundFirstDefinition = true;
            // Flush pending comments as header if before first definition
            if (pendingComments.length > 0 && !currentTable) {
                comments.push({
                    type: 'header',
                    text: pendingComments.join('\n'),
                });
                pendingComments = [];
            }
        }

        // Check for single-line comments
        const singleLineMatch = trimmedLine.match(/^\/\/(.*)$/);
        if (singleLineMatch) {
            if (!foundFirstDefinition) {
                // Header comment
                pendingComments.push(line);
            } else if (inTableBlock && braceDepth > 0) {
                // Comment inside a table block - associate with table
                comments.push({
                    type: 'field',
                    text: line,
                    context: { tableName: currentTable || undefined },
                });
            } else {
                // Comment between definitions
                pendingComments.push(line);
            }
        }

        // Check for inline comments (comment at end of a line with code)
        const inlineMatch = line.match(/^(.+?)(\/\/.*)$/);
        if (inlineMatch && !singleLineMatch) {
            const codePart = inlineMatch[1].trim();
            const commentPart = inlineMatch[2];

            // Check if this is a field line with inline comment
            const fieldMatch = codePart.match(/^"([^"]+)"/);
            if (fieldMatch && inTableBlock) {
                comments.push({
                    type: 'inline',
                    text: commentPart,
                    context: {
                        tableName: currentTable || undefined,
                        fieldName: fieldMatch[1],
                    },
                });
            }
        }

        // Check for multi-line comments
        const multiLineStart = trimmedLine.match(/^\/\*/);
        if (multiLineStart) {
            let multiLineComment = line;
            let j = i;

            // Find the end of the multi-line comment
            while (j < lines.length && !lines[j].includes('*/')) {
                j++;
                if (j < lines.length) {
                    multiLineComment += '\n' + lines[j];
                }
            }

            if (!foundFirstDefinition) {
                pendingComments.push(multiLineComment);
            } else if (inTableBlock && braceDepth > 0) {
                comments.push({
                    type: 'field',
                    text: multiLineComment,
                    context: { tableName: currentTable || undefined },
                });
            } else {
                pendingComments.push(multiLineComment);
            }

            i = j; // Skip processed lines
        }

        // Update brace depth
        braceDepth += openBraces - closeBraces;

        // Check if we're exiting a table block
        if (inTableBlock && braceDepth === 0 && closeBraces > 0) {
            inTableBlock = false;
            currentTable = null;
        }
    }

    // Any remaining pending comments are footer comments
    if (pendingComments.length > 0) {
        if (!foundFirstDefinition) {
            comments.push({
                type: 'header',
                text: pendingComments.join('\n'),
            });
        } else {
            comments.push({
                type: 'footer',
                text: pendingComments.join('\n'),
            });
        }
    }

    return comments;
}

/**
 * Merge extracted comments back into regenerated DBML
 */
export function mergeComments(
    regeneratedDbml: string,
    comments: DBMLComment[]
): string {
    if (comments.length === 0) {
        return regeneratedDbml;
    }

    const lines = regeneratedDbml.split('\n');
    const result: string[] = [];

    // Add header comments first
    const headerComments = comments.filter((c) => c.type === 'header');
    for (const comment of headerComments) {
        result.push(comment.text);
    }

    // Add blank line after header comments if there are any
    if (headerComments.length > 0 && lines.length > 0) {
        result.push('');
    }

    // Build a map of table comments
    const tableComments = new Map<string, string[]>();
    const fieldComments = new Map<string, string[]>();
    const inlineFieldComments = new Map<string, string>();

    for (const comment of comments) {
        if (comment.type === 'table' && comment.context?.tableName) {
            const existing = tableComments.get(comment.context.tableName) || [];
            existing.push(comment.text);
            tableComments.set(comment.context.tableName, existing);
        } else if (comment.type === 'field' && comment.context?.tableName) {
            const key = comment.context.tableName;
            const existing = fieldComments.get(key) || [];
            existing.push(comment.text);
            fieldComments.set(key, existing);
        } else if (
            comment.type === 'inline' &&
            comment.context?.tableName &&
            comment.context?.fieldName
        ) {
            const key = `${comment.context.tableName}.${comment.context.fieldName}`;
            inlineFieldComments.set(key, comment.text);
        }
    }

    let currentTable: string | null = null;
    let inTableBlock = false;
    let braceDepth = 0;
    let tableFieldCommentsAdded = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Track brace depth
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;

        // Check if this line starts a table definition
        const tableMatch = trimmedLine.match(
            /^Table\s+(?:"([^"]+)"\.)?(?:"([^"]+)"|(\w+))/i
        );

        if (tableMatch) {
            currentTable =
                tableMatch[2] || tableMatch[3] || tableMatch[1] || '';
            inTableBlock = true;
            tableFieldCommentsAdded = false;

            // Add table comments before the table definition
            const tableCommentsForThis = tableComments.get(currentTable);
            if (tableCommentsForThis) {
                for (const comment of tableCommentsForThis) {
                    result.push(comment);
                }
            }
        }

        // If we're inside a table and haven't added field comments yet
        if (
            inTableBlock &&
            braceDepth > 0 &&
            !tableFieldCommentsAdded &&
            currentTable
        ) {
            // Add field-level comments at the start of the table body
            const fieldCommentsForTable = fieldComments.get(currentTable);
            if (fieldCommentsForTable) {
                for (const comment of fieldCommentsForTable) {
                    result.push(comment);
                }
            }
            tableFieldCommentsAdded = true;
        }

        // Check for field lines and add inline comments
        if (inTableBlock && currentTable) {
            const fieldMatch = trimmedLine.match(/^"([^"]+)"/);
            if (fieldMatch) {
                const fieldName = fieldMatch[1];
                const key = `${currentTable}.${fieldName}`;
                const inlineComment = inlineFieldComments.get(key);
                if (inlineComment && !line.includes('//')) {
                    // Add inline comment to this line
                    result.push(line + ' ' + inlineComment);
                    braceDepth += openBraces - closeBraces;
                    if (inTableBlock && braceDepth === 0 && closeBraces > 0) {
                        inTableBlock = false;
                        currentTable = null;
                    }
                    continue;
                }
            }
        }

        result.push(line);

        // Update brace depth after processing
        braceDepth += openBraces - closeBraces;

        // Check if we're exiting a table block
        if (inTableBlock && braceDepth === 0 && closeBraces > 0) {
            inTableBlock = false;
            currentTable = null;
        }
    }

    // Add footer comments
    const footerComments = comments.filter((c) => c.type === 'footer');
    if (footerComments.length > 0) {
        result.push('');
        for (const comment of footerComments) {
            result.push(comment.text);
        }
    }

    return result.join('\n');
}

interface DBMLBlock {
    type: 'enum' | 'table' | 'ref' | 'other';
    content: string;
    tableName?: string;
    schemaName?: string;
}

/**
 * Parse DBML into blocks (enums, tables, refs, other)
 */
function parseDBMLIntoBlocks(dbml: string): DBMLBlock[] {
    const blocks: DBMLBlock[] = [];
    const lines = dbml.split('\n');

    let currentBlock: string[] = [];
    let currentType: DBMLBlock['type'] | null = null;
    let currentTableName: string | undefined;
    let currentSchemaName: string | undefined;
    let braceDepth = 0;

    const flushBlock = () => {
        if (currentBlock.length > 0 && currentType) {
            blocks.push({
                type: currentType,
                content: currentBlock.join('\n'),
                tableName: currentTableName,
                schemaName: currentSchemaName,
            });
        }
        currentBlock = [];
        currentType = null;
        currentTableName = undefined;
        currentSchemaName = undefined;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Track brace depth
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;

        // Check for new block start
        if (braceDepth === 0) {
            // Check for Table definition
            const tableMatch = trimmedLine.match(
                /^Table\s+(?:"([^"]+)"\.)?(?:"([^"]+)"|(\w+))/i
            );
            if (tableMatch) {
                flushBlock();
                currentType = 'table';
                currentSchemaName = tableMatch[1];
                currentTableName = tableMatch[2] || tableMatch[3] || '';
            }

            // Check for Enum definition
            const enumMatch = trimmedLine.match(/^Enum\s+/i);
            if (enumMatch) {
                flushBlock();
                currentType = 'enum';
            }

            // Check for Ref definition
            const refMatch = trimmedLine.match(/^Ref\s*[:{]/i);
            if (refMatch) {
                flushBlock();
                currentType = 'ref';
            }
        }

        // Add line to current block or as standalone
        if (currentType) {
            currentBlock.push(line);
        } else if (trimmedLine) {
            // Standalone lines (comments, blank lines between blocks)
            blocks.push({
                type: 'other',
                content: line,
            });
        } else if (blocks.length > 0) {
            // Preserve blank lines between blocks
            blocks.push({
                type: 'other',
                content: '',
            });
        }

        braceDepth += openBraces - closeBraces;

        // Check if block is complete
        if (currentType && braceDepth === 0 && closeBraces > 0) {
            flushBlock();
        }
    }

    // Flush any remaining block
    flushBlock();

    return blocks;
}

/**
 * Reorder DBML to match the original table order while preserving new tables at the end
 */
export function reorderDBML(
    regeneratedDbml: string,
    originalOrder: DBMLTableOrder[]
): string {
    const blocks = parseDBMLIntoBlocks(regeneratedDbml);

    // Separate blocks by type
    const enumBlocks: DBMLBlock[] = [];
    const tableBlocks: DBMLBlock[] = [];
    const refBlocks: DBMLBlock[] = [];

    for (const block of blocks) {
        switch (block.type) {
            case 'enum':
                enumBlocks.push(block);
                break;
            case 'table':
                tableBlocks.push(block);
                break;
            case 'ref':
                refBlocks.push(block);
                break;
            case 'other':
                // Skip standalone 'other' blocks (they'll be regenerated)
                break;
        }
    }

    // Create a map for quick lookup of original order
    const orderMap = new Map<string, number>();
    originalOrder.forEach((item, index) => {
        // Create key with both schema.table and just table name for matching
        const fullKey = item.schemaName
            ? `${item.schemaName}.${item.tableName}`
            : item.tableName;
        orderMap.set(fullKey, index);
        orderMap.set(item.tableName, index);
    });

    // Sort tables according to original order
    // Tables not in original order go to the end
    const sortedTableBlocks = [...tableBlocks].sort((a, b) => {
        const aKey = a.schemaName
            ? `${a.schemaName}.${a.tableName}`
            : a.tableName || '';
        const bKey = b.schemaName
            ? `${b.schemaName}.${b.tableName}`
            : b.tableName || '';

        const aOrder =
            orderMap.get(aKey) ?? orderMap.get(a.tableName || '') ?? Infinity;
        const bOrder =
            orderMap.get(bKey) ?? orderMap.get(b.tableName || '') ?? Infinity;

        return aOrder - bOrder;
    });

    // Rebuild DBML: Enums first, then tables in order, then refs
    const resultParts: string[] = [];

    // Add enums
    for (const block of enumBlocks) {
        resultParts.push(block.content);
    }

    // Add blank line after enums if there are tables
    if (enumBlocks.length > 0 && sortedTableBlocks.length > 0) {
        resultParts.push('');
    }

    // Add tables in sorted order
    for (const block of sortedTableBlocks) {
        resultParts.push(block.content);
    }

    // Add refs
    if (refBlocks.length > 0) {
        resultParts.push('');
        for (const block of refBlocks) {
            resultParts.push(block.content);
        }
    }

    // Clean up excessive blank lines and ensure proper formatting
    let result = resultParts.join('\n');
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

    // Ensure ends with single newline
    if (!result.endsWith('\n')) {
        result += '\n';
    }

    return result;
}
