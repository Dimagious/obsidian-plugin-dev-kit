// doiuse ships its types under types/ but does not list them in package.json, so TypeScript cannot find them.
// This declares the part of the API the scanner uses.
declare module "doiuse" {
    interface DoIUseUsage {
        readonly feature: string;
        /**
         * `partial` or `missing` holds the names of the browsers (for example "Chrome (142)") that support the feature
         * partly or not at all; the other one is absent. The whole object is `undefined` without support data.
         */
        readonly featureData: { readonly partial?: string; readonly missing?: string } | undefined;
        readonly usage: import("postcss").Node;
    }

    interface DoIUseOptions {
        readonly browsers?: string | readonly string[];
        onFeatureUsage?(usage: DoIUseUsage): void;
    }

    export default function doiuse(options?: DoIUseOptions): {
        postcss(root: import("postcss").Root, result: import("postcss").Result): Promise<void> | void;
    };
}
