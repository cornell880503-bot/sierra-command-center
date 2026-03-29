declare module 'mammoth/mammoth.browser.min.js' {
  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}
