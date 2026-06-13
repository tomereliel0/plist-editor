# Plist Editor

Plist Editor is a VS Code custom editor for `.plist` files. It is designed for fast nested editing with a compact tree-table layout, inline type switching, drag reordering, and direct save/revert support.

## Features

- Opens `.plist` files in a custom editor.
- Supports both XML plist files and binary plist files.
- Displays dictionaries and arrays as expandable tree branches.
- Uses a table-like layout with `Key`, `Type`, and `Value` columns.
- Supports drag-and-drop reordering for sibling rows.
- Includes compact add, duplicate, delete, and expand/collapse controls.
- Lets you resize the `Key` and `Type` columns from the header.
- Auto-fits `Key` and `Type` widths to the longest visible content by default.
- Keeps hierarchy aligned in the key column while preserving compact row spacing.
- Supports multiline editing for data values without visible textarea scrollbars.
- Uses a separate stylesheet in [media/plist-editor.css](media/plist-editor.css) so the UI is easy to tune.

## How To Use

1. Open a `.plist` file in VS Code.
2. If the custom editor does not open automatically, run `Open Plist Editor` from the Command Palette.
3. Edit dictionary keys, array values, and leaf values directly in the table.
4. Change a value type from the `Type` column when you want to convert a node.
5. Use the disclosure triangle on the left to expand or collapse dictionaries and arrays.
6. Drag the handle on the far left to reorder sibling entries.
7. Use the toolbar actions to add children, expand all branches, or collapse all branches.
8. Save the file normally with `Cmd+S` on macOS or `Ctrl+S` on Windows/Linux.

## Safety Notes

Some type changes can destroy nested data.

- Dictionary, array, and root nodes can be converted to other types.
- Converting a container to a leaf value removes its nested structure.
- The editor keeps complex type changes disabled by default.
- Enable complex type editing only when you intentionally want to replace container data.

When complex type editing is enabled, the editor shows a warning before allowing the change.

## Supported Value Types

The editor currently supports these plist value kinds:

- Dictionary
- Array
- String
- Number
- Boolean
- Date
- Data

## Layout Guide

The editor is organized as a single grid-based tree table:

- `Key` shows dictionary keys and array indices.
- `Type` switches the plist value kind.
- `Value` edits the current value or shows container metadata.
- The rightmost column contains compact row actions.

Nested rows remain aligned to the same header columns even when branches are expanded several levels deep.

## Toolbar Controls

- `Allow complex type edits` unlocks container and root type conversion after a warning prompt.
- `Add Root Child` inserts a new child at the top level.
- `Expand All` opens every branch in the tree.
- `Collapse All` closes every branch in the tree.

## Styling

The editor UI styling lives in [media/plist-editor.css](media/plist-editor.css).

That file controls:

- Layout and spacing
- Colors and borders
- Column widths and row sizing
- Tree indentation
- Row highlighting and selection
- Button and icon treatment

If you want to change the look of the editor, start there.

## Development

To work on the extension:

1. Run `npm install` once.
2. Use `npm run compile` to verify the code builds cleanly.
3. Use `npm run watch` while developing if you want continuous TypeScript and esbuild rebuilds.
4. Open the extension host in VS Code and test against real plist files.

Useful scripts:

- `npm run check-types` checks the TypeScript project.
- `npm run lint` runs ESLint over `src`.
- `npm run compile` runs typecheck, lint, and bundling.
- `npm run watch` keeps the extension build updated during development.
- `npm test` runs the extension test suite.

## Limitations

- The editor is optimized for direct plist editing, not for full Xcode feature parity.
- Some Apple-specific plist edge cases are not modeled explicitly.
- Very large trees may still need collapsing or manual resizing to stay comfortable on screen.

## Project Files

- [src/extension.ts](src/extension.ts) registers the custom editor and command.
- [src/plistEditor.ts](src/plistEditor.ts) contains the custom editor implementation.
- [media/plist-editor.css](media/plist-editor.css) contains the editor styling.

## Release Notes

### 0.0.1

- Initial plist custom editor.
- Nested tree editing, inline type switching, drag reordering, and compact row actions.
- Externalized stylesheet for easier UI tuning.
