export class Decoder {

  static decodeBase64(text: string): string[] {
    const found: string[] = [];
    const pattern = /['"`]([A-Za-z0-9+/]{40,}={0,2})['"`;,\s]/g;
    for (const match of text.matchAll(pattern)) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
        if (this.containsM3U8(decoded)) {
          found.push(...this.extractUrls(decoded));
        }
      } catch {}
    }
    return found;
  }

  static decodeRot13(text: string): string {
    return text.replace(/[A-Za-z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
  }

  static decodeUnicode(text: string): string {
    try {
      return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    } catch { return text; }
  }

  static decodeAtob(text: string): string[] {
    const found: string[] = [];
    const pattern = /atob\(['"`]([A-Za-z0-9+/=]+)['"`]\)/g;
    for (const match of text.matchAll(pattern)) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
        if (this.containsM3U8(decoded)) {
          found.push(...this.extractUrls(decoded));
        }
      } catch {}
    }
    return found;
  }

  static decodeCharCode(text: string): string[] {
    const found: string[] = [];
    const pattern = /String\.fromCharCode\(([0-9,\s]+)\)/g;
    for (const match of text.matchAll(pattern)) {
      try {
        const chars = match[1].split(',').map((n: string) => parseInt(n.trim()));
        const decoded = String.fromCharCode(...chars);
        if (this.containsM3U8(decoded)) {
          found.push(...this.extractUrls(decoded));
        }
      } catch {}
    }
    return found;
  }

  static decodeHiddenJson(text: string): string[] {
    const found: string[] = [];
    const pattern = /['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/g;
    for (const match of text.matchAll(pattern)) {
      found.push(match[1]);
    }
    return found;
  }

  static decodeAll(text: string): string[] {
    const results = new Set<string>();
    this.extractUrls(text).forEach((u: string) => results.add(u));
    this.decodeBase64(text).forEach((u: string) => results.add(u));
    this.decodeAtob(text).forEach((u: string) => results.add(u));
    this.decodeCharCode(text).forEach((u: string) => results.add(u));
    this.decodeHiddenJson(text).forEach((u: string) => results.add(u));
    this.extractUrls(this.decodeUnicode(text)).forEach((u: string) => results.add(u));
    const rot13 = this.decodeRot13(text);
    if (this.containsM3U8(rot13)) {
      this.extractUrls(rot13).forEach((u: string) => results.add(u));
    }
    return [...results];
  }

  static containsM3U8(text: string): boolean {
    return (
      text.includes('.m3u8') ||
      text.includes('/hls/') ||
      text.includes('manifest.m3u') ||
      text.includes('playlist.m3u') ||
      text.includes('index.m3u')
    );
  }

  static extractUrls(text: string): string[] {
    const pattern = /https?:\/\/[^\s'"<>`,\\]+\.m3u8[^\s'"<>`,\\]*/g;
    return [...new Set(text.match(pattern) || [])];
  }

  static detectQuality(url: string, label?: string): string {
    const combined = `${url} ${label || ''}`.toLowerCase();
    if (combined.includes('4k') || combined.includes('2160')) return '4K';
    if (combined.includes('1080')) return '1080p';
    if (combined.includes('720')) return '720p';
    if (combined.includes('480')) return '480p';
    if (combined.includes('360')) return '360p';
    if (combined.includes('240')) return '240p';
    return 'auto';
  }
}
