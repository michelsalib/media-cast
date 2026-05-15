export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`,
    'i'
  );
  return re.exec(xml)?.[1];
}

export function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*\\s${attr}\\s*=\\s*"([^"]*)"`, 'i');
  return re.exec(xml)?.[1];
}
