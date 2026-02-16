export function DemoVideo() {
  return (
    <div className="app">
      <span className="vertical-label">Demo</span>
      <span className="registration-mark top-center">+</span>
      <span className="registration-mark bottom-center">+</span>
      <div className="demo-video-page">
        <a href="/" className="thread-empty demo-video-logo-link">
          <hr className="thread-empty-rule" />
          <h2>Column<br />Chat</h2>
          <hr className="thread-empty-rule" />
          <p>Perspectives that build on each other.</p>
        </a>
        <div className="demo-video-container">
          <iframe
            src="https://drive.google.com/file/d/1yYmXSuWeglc2kYy99A3nPwCXd1T2IRmr/preview"
            allow="autoplay"
          />
        </div>
        <div className="demo-video-links">
          <a href="/" className="preset-build-own">Try it yourself</a>
          <a href="https://drive.google.com/uc?export=download&id=1yYmXSuWeglc2kYy99A3nPwCXd1T2IRmr" className="preset-build-own">Download video</a>
        </div>
      </div>
    </div>
  );
}
