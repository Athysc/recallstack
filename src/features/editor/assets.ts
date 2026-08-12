export function isScreenshotItem(file: Pick<File, "name">): boolean {
  return !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

export function assetMarkdownLink(filename: string, relativePath: string, image: boolean): string {
  const link = `[${filename}](${relativePath})`;
  return image ? `!${link}` : link;
}

export function joinDroppedAssetLinks(links: string[], needsLeadingNewline: boolean): string {
  if (links.length <= 1) return links[0] || "";
  return `${needsLeadingNewline ? "\n" : ""}${links.join("\n")}`;
}
