import { pageMeta } from '@shared/seo';
import { Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Status } from './components/ui';
import { api } from './lib/api';
import { useState } from 'react';
import type { Capabilities, Content, User } from './lib/api';
import { AuthContext, CapabilitiesContext, ContentContext, useAsync, useContent, useHead } from './lib/hooks';
import { Account, Login, Signup } from './pages/Auth';
import { VideoAnalyzer } from './pages/VideoAnalyzer';
import { Blog, PostPage } from './pages/Blog';
import Home from './pages/Home';
import { Library, ReportPage } from './pages/Library';
import { Checkout, Pricing } from './pages/Pricing';
import { Results } from './pages/Results';
import { About, Affiliates, Contact, GetStarted, Legal, NotFound, PlatformGuide } from './pages/Static';
import { HookAnalyzer, ScriptAnalyzer, ToolsHub } from './pages/Tools';

export type Boot = [Content, { user: User | null }, Capabilities];
/** Site content, who is signed in and what the server can do. */
export const loadBoot = (): Promise<Boot> => Promise.all([api.content(), api.auth.me(), api.capabilities()]);

/** Sets the head tags for the current route. Pages that load their own subject, such as an article, refine them. */
function RouteHead() {
  const { pathname } = useLocation();
  const { platforms } = useContent();
  useHead(pageMeta(pathname, { platforms }));
  return null;
}

export default function App({ initial }: { initial?: Boot }) {
  // Loaded before the first render. When the server sent a readable page, main.tsx loads this first and passes it in.
  const boot = useAsync(loadBoot, [], initial);
  const [signedIn, setSignedIn] = useState<User | null | undefined>(undefined);
  if (!boot.data) {
    return <Layout><Status loading={boot.loading} error={boot.error} retry={boot.reload} /></Layout>;
  }
  const [content, me, capabilities] = boot.data;
  const user = signedIn === undefined ? me.user : signedIn;
  return (
    <AuthContext.Provider value={{ user, setUser: setSignedIn }}>
    <CapabilitiesContext.Provider value={capabilities}>
    <ContentContext.Provider value={content}>
      <Layout>
        <RouteHead />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tools" element={<ToolsHub />} />
          <Route path="/tools/hook" element={<HookAnalyzer />} />
          <Route path="/tools/script" element={<ScriptAnalyzer />} />
          <Route path="/tools/video" element={<VideoAnalyzer />} />
          <Route path="/library" element={<Library />} />
          <Route path="/reports/:id" element={<ReportPage />} />
          <Route path="/results" element={<Results />} />
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
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </ContentContext.Provider>
    </CapabilitiesContext.Provider>
    </AuthContext.Provider>
  );
}
