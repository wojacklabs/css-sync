import fastDiff from 'fast-diff';

/**
 * 두 텍스트 간의 차이점을 찾아서 변경된 범위를 반환
 * @param {string} oldText - 이전 텍스트
 * @param {string} newText - 새 텍스트
 * @returns {Array<{type: 'insert'|'delete'|'replace', start: number, end: number, oldContent: string, newContent: string}>}
 */
export function findChanges(oldText, newText) {
  const diffs = fastDiff(oldText, newText);
  const changes = [];

  let oldPos = 0;
  let newPos = 0;
  let i = 0;

  while (i < diffs.length) {
    const [type, text] = diffs[i];

    if (type === fastDiff.EQUAL) {
      oldPos += text.length;
      newPos += text.length;
      i++;
    } else if (type === fastDiff.DELETE) {
      // DELETE 다음에 INSERT가 오면 REPLACE로 처리
      if (i + 1 < diffs.length && diffs[i + 1][0] === fastDiff.INSERT) {
        const deleteText = text;
        const insertText = diffs[i + 1][1];

        changes.push({
          type: 'replace',
          oldStart: oldPos,
          oldEnd: oldPos + deleteText.length,
          newStart: newPos,
          newEnd: newPos + insertText.length,
          oldContent: deleteText,
          newContent: insertText
        });

        oldPos += deleteText.length;
        newPos += insertText.length;
        i += 2;
      } else {
        changes.push({
          type: 'delete',
          oldStart: oldPos,
          oldEnd: oldPos + text.length,
          newStart: newPos,
          newEnd: newPos,
          oldContent: text,
          newContent: ''
        });

        oldPos += text.length;
        i++;
      }
    } else if (type === fastDiff.INSERT) {
      changes.push({
        type: 'insert',
        oldStart: oldPos,
        oldEnd: oldPos,
        newStart: newPos,
        newEnd: newPos + text.length,
        oldContent: '',
        newContent: text
      });

      newPos += text.length;
      i++;
    }
  }

  return changes;
}

/**
 * 문자 오프셋을 라인/컬럼으로 변환
 * @param {string} text - 전체 텍스트
 * @param {number} offset - 문자 오프셋
 * @returns {{line: number, column: number}} - 1-based 라인, 0-based 컬럼
 */
export function offsetToPosition(text, offset) {
  let line = 1;
  let column = 0;
  let pos = 0;

  while (pos < offset && pos < text.length) {
    if (text[pos] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
    pos++;
  }

  return { line, column };
}

/**
 * 라인/컬럼을 문자 오프셋으로 변환
 * @param {string} text - 전체 텍스트
 * @param {number} line - 1-based 라인
 * @param {number} column - 0-based 컬럼
 * @returns {number} - 문자 오프셋
 */
export function positionToOffset(text, line, column) {
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  offset += column;
  return offset;
}
