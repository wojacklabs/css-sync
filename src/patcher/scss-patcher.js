import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import postcss from 'postcss';
import scss from 'postcss-scss';

export class SCSSPatcher {
  constructor(options = {}) {
    this.atomicWrite = options.atomicWrite !== false;
  }

  /**
   * SCSS 파일에서 특정 선언 수정
   * @param {string} filePath - SCSS 파일 경로
   * @param {Array<{selector: string, prop: string, newValue: string, type: string}>} changes
   * @returns {Promise<{success: number, failed: number}>}
   */
  async patchMultiple(filePath, changes) {
    if (!existsSync(filePath)) {
      console.error(`파일을 찾을 수 없습니다: ${filePath}`);
      return { success: 0, failed: changes.length };
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      // postcss-scss의 parse를 직접 사용해야 SCSS 변수가 인식됨
      const root = scss.parse(content);

      let success = 0;
      let failed = 0;

      for (const change of changes) {
        let found = false;
        let targetRule = null;

        // 해당 셀렉터의 규칙 찾기 (SCSS는 중첩 가능)
        this.walkRulesDeep(root, (rule, fullSelector) => {
          if (this.matchSelector(fullSelector, change.selector)) {
            targetRule = rule;

            if (change.type === 'delete') {
              rule.walkDecls(change.prop, (decl) => {
                decl.remove();
                found = true;
              });
            } else {
              rule.walkDecls(change.prop, (decl) => {
                const hasImportant = change.newValue?.includes('!important');
                const cleanValue = change.newValue?.replace(/\s*!important\s*$/, '').trim();

                decl.value = cleanValue;
                decl.important = hasImportant;
                found = true;
              });
            }
          }
        });

        // 추가: 규칙은 있지만 속성이 없는 경우
        if (!found && targetRule && change.type === 'add' && change.newValue) {
          const hasImportant = change.newValue.includes('!important');
          const cleanValue = change.newValue.replace(/\s*!important\s*$/, '').trim();

          targetRule.append({
            prop: change.prop,
            value: cleanValue,
            important: hasImportant
          });
          found = true;
        }

        if (found) {
          success++;
        } else {
          failed++;
        }
      }

      if (success > 0) {
        await this.writeFile(filePath, root.toString());
      }

      return { success, failed };
    } catch (error) {
      console.error(`SCSS 패치 실패: ${error.message}`);
      return { success: 0, failed: changes.length };
    }
  }

  /**
   * SCSS의 중첩 규칙을 순회하면서 전체 셀렉터 계산
   */
  walkRulesDeep(node, callback, parentSelector = '') {
    node.each((child) => {
      if (child.type === 'rule') {
        // 중첩 셀렉터 처리 (& 참조 포함)
        const selectors = child.selector.split(',').map(s => s.trim());
        const fullSelectors = selectors.map(s => {
          if (s.startsWith('&')) {
            return parentSelector + s.slice(1);
          } else if (parentSelector) {
            return `${parentSelector} ${s}`;
          }
          return s;
        });

        for (const fullSelector of fullSelectors) {
          callback(child, fullSelector);
        }

        // 중첩 규칙 재귀 처리
        for (const fullSelector of fullSelectors) {
          this.walkRulesDeep(child, callback, fullSelector);
        }
      }
    });
  }

  /**
   * 셀렉터 매칭 (정규화 후 비교)
   */
  matchSelector(fileSelector, targetSelector) {
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();
    return normalize(fileSelector) === normalize(targetSelector);
  }

  /**
   * 파일 쓰기 (atomic write 옵션)
   */
  async writeFile(filePath, content) {
    if (this.atomicWrite) {
      const tempPath = join(dirname(filePath), `.${Date.now()}.tmp`);
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, filePath);
    } else {
      await writeFile(filePath, content, 'utf-8');
    }
  }
}
