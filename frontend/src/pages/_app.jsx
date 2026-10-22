/**
 * _app.jsx — Issue #9
 *
 * Error boundary layering:
 *
 *   App-level boundary  (outermost — catches anything that escapes a route boundary)
 *   └─ Route-level boundary  (keyed on `router.pathname` so it auto-resets on navigation)
 *       └─ Page Component
 *
 * The route-level boundary key ensures that navigating away from a broken page
 * fully unmounts the failed subtree and mounts a fresh boundary, so the user
 * never sees a stale error screen after clicking a navigation link.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import "../styles/globals.css";
import "../styles/redesign.css";
import Navbar from "../components/Navbar";
import AppLayout from "../components/AppLayout";
import ErrorBoundary from "../components/ErrorBoundary";
import { AdminAuthProvider } from "../hooks/AdminAuthContext";
import i18n, { SUPPORTED_LOCALES } from "../i18n";

export const ThemeContext = createContext({ dark: false, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

const APP_LAYOUT_ROUTES = [
  "/dashboard",
  "/reports",
  "/fees",
  "/fee-adjustments",
  "/audit-logs",
  "/disputes",
  "/source-validation-rules",
  "/audit-logs",
  "/fee-adjustments",
  "/fees",
  "/reports",
];

export default function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const { pathname } = router;
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setDark(true);
    } else if (saved === "light") {
      setDark(false);
    } else {
      setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const useAppLayout = APP_LAYOUT_ROUTES.includes(pathname);

  return (
    <AdminAuthProvider>
      <ThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>
        <Head>
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        </Head>
        <Navbar />

        {/* App-level boundary: last-resort catch for anything the route boundary misses */}
        <ErrorBoundary>
          {/* Route-level boundary: keyed on pathname so it resets on every navigation.
              This ensures a render error on one route doesn't persist after the user
              navigates to a different route. — Issue #9 */}
          <ErrorBoundary key={pathname}>
            {useAppLayout ? (
              <AppLayout>
                <Component {...pageProps} />
              </AppLayout>
            ) : (
              <Component {...pageProps} />
            )}
          </ErrorBoundary>
        </ErrorBoundary>
      </ThemeContext.Provider>
    </AdminAuthProvider>
  );
}

MyApp.getInitialProps = async ({ Component, ctx }) => {
  const pageProps = await (Component.getInitialProps
    ? Component.getInitialProps(ctx)
    : {});

  // #1385 — robots.txt only asks crawlers not to fetch these URLs; a page
  // that's still linked from somewhere else can get indexed anyway without
  // an explicit noindex signal. APP_LAYOUT_ROUTES is exactly the set of
  // authenticated admin pages (dashboard, audit logs, fee adjustments,
  // disputes, etc.), so it doubles as the noindex route list.
  if (ctx.res && APP_LAYOUT_ROUTES.includes(ctx.pathname)) {
    ctx.res.setHeader("X-Robots-Tag", "noindex");
  }

  const acceptLang = ctx.req?.headers?.["accept-language"] || "";
  const primary = acceptLang
    .split(",")[0]
    .trim()
    .split(";")[0]
    .split("-")[0]
    .toLowerCase();
  if (primary && SUPPORTED_LOCALES.includes(primary)) {
    i18n.changeLanguage(primary);
  }

  return { pageProps };
};
