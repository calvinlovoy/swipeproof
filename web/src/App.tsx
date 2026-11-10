import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Status } from './components/ui';
import { api } from './lib/api';
import { ContentContext, useAsync } from './lib/hooks';
import { Blog, PostPage } from './pages/Blog';
import Home from './pages/Home';
import { Library, ReportPage } from './pages/Library';
import { Checkout, Pricing } from './pages/Pricing';
import { About, Affiliates, Contact, GetStarted, Legal, NotFound, PlatformGuide } from './pages/Static';
import { HookAnalyzer, ScriptAnalyzer, ToolsHub, VideoAnalyzer } from './pages/Tools';

export default function App() {
  const content = useAsync(api.content, []);
  if (!content.data) {
    return <Layout><Status loading={content.loading} error={content.error} retry={content.reload} /></Layout>;
  }
  return (
    <ContentContext.Provider value={content.data}>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tools" element={<ToolsHub />} />
          <Route path="/tools/hook" element={<HookAnalyzer />} />
          <Route path="/tools/script" element={<ScriptAnalyzer />} />
          <Route path="/tools/video" element={<VideoAnalyzer />} />
          <Route path="/library" element={<Library />} />
          <Route path="/reports/:id" element={<ReportPage />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<PostPage />} />
          <Route path="/for/:id" element={<PlatformGuide />} />
          <Route path="/get-started" element={<GetStarted />} />
          <Route path="/affiliates" element={<Affiliates />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </ContentContext.Provider>
  );
}
