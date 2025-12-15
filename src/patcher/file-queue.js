/**
 * 파일 단위 mutex를 제공하는 큐
 * 같은 파일에 대한 연속 작업을 순차적으로 처리
 */
export class FileQueue {
  constructor() {
    // 파일 경로 -> Promise 체인
    this.queues = new Map();
  }

  /**
   * 파일에 대한 작업을 큐에 추가
   * @param {string} filePath - 파일 경로
   * @param {Function} task - 실행할 비동기 작업
   * @returns {Promise} - 작업 완료 Promise
   */
  async enqueue(filePath, task) {
    const previousTask = this.queues.get(filePath) || Promise.resolve();

    const currentTask = previousTask
      .catch(() => {}) // 이전 작업 실패해도 계속 진행
      .then(() => task());

    this.queues.set(filePath, currentTask);

    try {
      return await currentTask;
    } finally {
      // 큐가 비었으면 정리
      if (this.queues.get(filePath) === currentTask) {
        this.queues.delete(filePath);
      }
    }
  }

  /**
   * 특정 파일의 대기 중인 작업 수
   */
  getPendingCount(filePath) {
    return this.queues.has(filePath) ? 1 : 0;
  }

  /**
   * 모든 큐 정리
   */
  clear() {
    this.queues.clear();
  }
}
