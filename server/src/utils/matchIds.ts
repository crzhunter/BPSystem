const matchUrl =
  /(?:https?:\/\/)?(?:(?:www|cn|zh)\.)?(?:opendota|dotabuff|stratz)\.com\/matches\/(\d+)(?:[/?#][^\s，。；]*)?/gi;

// 纯编号清单兼容早期短 ID；群聊中的时间、比分和网址参数不作为比赛编号。
export function extractMatchIds(text: string): number[] {
  const plainList = /^[\d\s,，;；]*$/.test(text.replace(matchUrl, ' '));
  const pattern = new RegExp(
    matchUrl.source +
      (plainList ? '|(?<![\\w/])(\\d{1,12})(?!\\w)' : '|(?<![\\w/])(\\d{7,12})(?!\\w)'),
    'gi',
  );
  const ids = new Set<number>();
  for (const token of text.matchAll(pattern)) {
    const id = Number(token[1] ?? token[2]);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}
