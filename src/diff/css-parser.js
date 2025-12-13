import postcss from 'postcss';
import { findChanges, offsetToPosition } from './text-diff.js';

/**
 * CSS 텍스트를 파싱하여 모든 declaration의 위치 정보를 추출
 * @param {string} cssText - CSS 텍스트
 * @returns {Array<{selector: string, prop: string, value: string, start: {line, column}, end: {line, column}, valueStart: {line, column}}>}
 */
export function parseDeclarations(cssText) {
  const declarations = [];

  try {
    const root = postcss.parse(cssText);

    root.walkDecls((decl) => {
      const rule = decl.parent;
      const selector = rule.selector || rule.name || '(unknown)';

      if (decl.source && decl.source.start) {
        declarations.push({
          selector,
          prop: decl.prop,
          value: decl.value,
          important: decl.important,
          start: {
            line: decl.source.start.line,
            column: decl.source.start.column - 1 // postcss는 1-based column
          },
          end: decl.source.end ? {
            line: decl.source.end.line,
            column: decl.source.end.column - 1
          } : null
        });
      }
    });
  } catch (error) {
    console.error('CSS 파싱 오류:', error.message);
  }

  return declarations;
}

/**
 * 이전 CSS와 새 CSS를 비교하여 변경된 declaration 목록 반환
 * @param {string} oldCss - 이전 CSS 텍스트
 * @param {string} newCss - 새 CSS 텍스트
 * @returns {Array<{selector: string, prop: string, oldValue: string, newValue: string, position: {line, column}}>}
 */
export function findChangedDeclarations(oldCss, newCss) {
  const oldDecls = parseDeclarations(oldCss);
  const newDecls = parseDeclarations(newCss);

  const changedDeclarations = [];

  // selector + prop을 키로 사용하여 매칭
  const oldDeclMap = new Map();
  for (const decl of oldDecls) {
    const key = `${decl.selector}|${decl.prop}`;
    if (!oldDeclMap.has(key)) {
      oldDeclMap.set(key, []);
    }
    oldDeclMap.get(key).push(decl);
  }

  const newDeclMap = new Map();
  for (const decl of newDecls) {
    const key = `${decl.selector}|${decl.prop}`;
    if (!newDeclMap.has(key)) {
      newDeclMap.set(key, []);
    }
    newDeclMap.get(key).push(decl);
  }

  // 변경된 값 찾기
  for (const [key, newDeclList] of newDeclMap) {
    const oldDeclList = oldDeclMap.get(key) || [];

    for (let i = 0; i < newDeclList.length; i++) {
      const newDecl = newDeclList[i];
      const oldDecl = oldDeclList[i];

      if (!oldDecl) {
        // 새로 추가된 declaration
        changedDeclarations.push({
          type: 'add',
          selector: newDecl.selector,
          prop: newDecl.prop,
          oldValue: null,
          newValue: newDecl.value,
          important: newDecl.important,
          position: newDecl.start
        });
      } else if (oldDecl.value !== newDecl.value || oldDecl.important !== newDecl.important) {
        // 값이 변경된 declaration
        changedDeclarations.push({
          type: 'change',
          selector: newDecl.selector,
          prop: newDecl.prop,
          oldValue: oldDecl.value + (oldDecl.important ? ' !important' : ''),
          newValue: newDecl.value + (newDecl.important ? ' !important' : ''),
          important: newDecl.important,
          position: newDecl.start
        });
      }
    }
  }

  // 삭제된 declaration 찾기
  for (const [key, oldDeclList] of oldDeclMap) {
    const newDeclList = newDeclMap.get(key) || [];

    for (let i = newDeclList.length; i < oldDeclList.length; i++) {
      const oldDecl = oldDeclList[i];
      changedDeclarations.push({
        type: 'delete',
        selector: oldDecl.selector,
        prop: oldDecl.prop,
        oldValue: oldDecl.value,
        newValue: null,
        position: oldDecl.start
      });
    }
  }

  return changedDeclarations;
}
