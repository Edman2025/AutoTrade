import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error("AMM console render failure", { message: error.message, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-error" role="alert"><strong>控制台显示异常</strong><p>链上服务没有因此执行任何交易。请刷新页面；若仍失败，请查看服务端健康检查与审计日志。</p><button type="button" onClick={() => window.location.reload()}>重新加载</button></main>;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);
