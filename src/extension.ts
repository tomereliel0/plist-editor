import * as vscode from 'vscode';
import { PlistEditorProvider } from './plistEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(PlistEditorProvider.register(context));
	context.subscriptions.push(
		vscode.commands.registerCommand('plist-editor.openPlistEditor', async (uri?: vscode.Uri) => {
			let target = uri ?? vscode.window.activeTextEditor?.document.uri;

			if (!target) {
				const selection = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					filters: {
						'Property List': ['plist'],
					},
				});

				target = selection?.[0];
			}

			if (!target) {
				return;
			}

			await vscode.commands.executeCommand('vscode.openWith', target, PlistEditorProvider.viewType);
		}),
	);
}

export function deactivate() {}
