// noinspection JSUnusedGlobalSymbols

declare module "puppeteer" {
    // source code implements both Symbol.dispose and Symbol.asyncDispose
    interface Browser extends Disposable, AsyncDisposable {
    }

    // source code implements both Symbol.dispose and Symbol.asyncDispose
    interface Page extends Disposable, AsyncDisposable {
    }
}

export {};
