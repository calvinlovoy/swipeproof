import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Status } from './components/ui';
import { api } from './lib/api';
import { useState } from 'react';
import type { User } from './lib/api';
import { AuthContext, CapabilitiesContext, ContentContext, useAsync } from './lib/hooks';
import { Account, Login, Signup } from './pages/Auth';
import { VideoAnalyzer } from './pages/VideoAnalyzer';
import { Blog, PostPage } from './pages/Blog';
import Home from './pages/Home';
import { Library, ReportPage } from './pages/Library';
import { Checkout, Pricing } from './pages/Pricing';
import { About, Affiliates, Contact, GetStarted, Legal, NotFound, PlatformGuide } from './pages/Static';
import { HookAnalyzer, ScriptAnalyzer, ToolsHub } from './pages/Tools';

export default function App() {
  // Site content, who is signed in and what the server can do, loaded together before the first render.
  const boot = useAsync(() => Promise.all([api.content(), api.auth.me(), api.capabilities()]), []);
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
