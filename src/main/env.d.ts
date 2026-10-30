interface ImportMetaEnv {
  // OpenSubtitles.com consumer key; see .env.local / the release workflow.
  readonly MAIN_VITE_OPENSUBTITLES_API_KEY?: string;
  readonly MAIN_VITE_SUBDL_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
