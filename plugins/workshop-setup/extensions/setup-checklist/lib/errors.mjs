// Expected failures carry a stable code. extension.mjs turns them into CanvasError, so the modules here stay free of
// the SDK and can be tested on their own.
export class SetupError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SetupError';
		this.code = code;
	}
}
