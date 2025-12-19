import { useState } from 'react'
import './App.scss'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <div className="header">
        <h1>CSS Sync 테스트</h1>
        <p>DevTools에서 스타일을 수정하고 SCSS 파일이 업데이트되는지 확인하세요</p>
      </div>

      <div className="card">
        <div className="count">{count}</div>
        <button className="button" onClick={() => setCount((count) => count + 1)}>
          카운트 증가
        </button>
      </div>
    </div>
  )
}

export default App
