# plist Editor

Plist Editor is a VS Code custom editor for `.plist` files. It focuses on fast nested editing with a compact table layout, tree disclosure controls, inline type switching, and direct save/revert support.

## Features

- Opens `.plist` files in a custom editor.
- Supports XML and binary plist files.
- Renders nested dictionaries and arrays as an expandable tree.
- Shows a table with `Key`, `Type`, and `Value` columns.
- Lets you resize the `Key` and `Type` columns from the header.
- Auto-fits the `Key` and `Type` columns to the longest visible content.
- Supports drag-and-drop reordering for sibling rows.
- Includes compact add, duplicate, delete, and expand/collapse controls.
- Keeps the UI styled in [media/plist-editor.css](media/plist-editor.css), so spacing and colors are easy to adjust.

## How To Use

1. Open any `.plist` file in VS Code.
2. If VS Code does not open the custom editor automatically, use the command palette and run `Open Plist Editor`.
3. Edit keys, types, and values directly in the table.
4. Use the triangle next to a container row to expand or collapse branches.
5. Drag a row using the handle to reorder siblings.
6. Save the file as usual with `Cmd+S` / `Ctrl+S`.

## Layout Guide

The editor is organized as a single table-like grid:

- `Key` holds dictionary keys and array indices.
- `Type` switches the plist value type.
- `Value` edits the selected value.
- The last column contains compact row actions.

Nested rows stay aligned to the same header columns even when branches expand several levels deep.

## Supported Values

The editor currently handles the common plist value kinds:

- Dictionary
- Array
- String
- Number
- Boolean
- Date
- Data

## Styling

The webview styles live in [media/plist-editor.css](media/plist-editor.css). That file controls the layout, spacing, colors, column sizing, and icon treatment for the editor UI. It is the best place to make visual adjustments.

## Development

If you are working on the extension itself:

1. Run `npm install` once.
2. Use `npm run compile` to validate the build.
3. Open the extension host from VS Code and test the editor against real plist files.

## Limitations

- The editor is optimized for direct editing, not for full Xcode parity.
- Some advanced plist metadata and exotic Apple-specific edge cases are not modeled explicitly.
- Very large trees can still require manual resizing or collapsing to stay comfortable on screen.

## Release Notes

### 0.0.1

- Initial plist custom editor.
- Nested tree editing, inline type switching, drag reordering, and compact row actions.
- Externalized stylesheet for easier UI tuning.
