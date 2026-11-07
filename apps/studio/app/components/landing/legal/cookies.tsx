import { H3, type LegalDoc, Mail, Table } from "./legal-page";
import { LEGAL } from "./legal-info";

export const cookiesDoc: LegalDoc = {
  slug: "cookies",
  title: "Cookie Policy",
  intro: (
    <p>
      This page lists the cookies and browser storage {LEGAL.product} uses on {LEGAL.host}, what each is for, how long it lasts and how you can
      control it. It adds detail to our <a href="/privacy">Privacy Policy</a>.
    </p>
  ),
  sections: [
    {
      id: "what",
      title: "What cookies are",
      body: (
        <p>
          Cookies are small text files a website saves in your browser. &ldquo;Local storage&rdquo; and &ldquo;session storage&rdquo; are similar:
          your browser keeps them for the site, but they are not sent to our servers automatically. In this policy, &ldquo;cookies&rdquo; covers
          all three.
        </p>
      ),
    },
    {
      id: "categories",
      title: "The kinds we use",
      body: (
        <>
          <ul>
            <li>
              <strong>Strictly necessary:</strong> sign-in, security and remembering your choices. The site doesn&rsquo;t work without them, so
              they are always on.
            </li>
            <li>
              <strong>Analytics:</strong> random IDs that let us count visits and visitors. Today they stay on {LEGAL.product}: we don&rsquo;t send
              them to any analytics company.
            </li>
            <li>
              <strong>Advertising and attribution:</strong> they remember which link or campaign brought you to {LEGAL.product}, so we know which
              ones work. We don&rsquo;t run ads on {LEGAL.product} and we don&rsquo;t share these with advertising networks.
            </li>
          </ul>
          <p>
            All the cookies on {LEGAL.host} are our own (first-party). We don&rsquo;t place cookies from advertising or social media companies.
            When you connect YouTube, Google&rsquo;s sign-in pages set Google&rsquo;s own cookies under its policies.
          </p>
        </>
      ),
    },
    {
      id: "list",
      title: "The cookies we set",
      body: (
        <>
          <p>
            On secure (https) connections, some sign-in cookie names start with <code>__Secure-</code>. Names may carry a short suffix that
            identifies the app.
          </p>
          <Table
            caption="Strictly necessary"
            head={["Name", "Purpose", "Lasts"]}
            rows={[
              [<code key="n">an.session_token</code>, "Keeps you signed in", "30 days, renewed as you use the app"],
              [<code key="n">an.session_data</code>, "A short-lived copy of your sign-in, so pages load faster", "5 minutes"],
              [<code key="n">an.dont_remember</code>, "Ends your session when you close the browser, if you chose not to be remembered", "Until you close the browser"],
              ["Two-step sign-in cookies", "Complete sign-in when you use two-step verification", "A few minutes"],
              [<code key="n">an_session</code>, "Keeps your signed-in session for the app", "30 days"],
              [<code key="n">an_session_hint</code>, "Tells pages you are signed in, so they show the right screen", "30 days"],
              [<code key="n">an_org_selection</code>, "Remembers which team you are working in", "Until you close the browser"],
              [<code key="n">agent-native-first-run</code>, "Finishes first-time setup", "1 day"],
              [<code key="n">an_consent</code>, "Remembers your cookie choices", "1 year"],
            ]}
          />
          <Table
            caption="Analytics"
            head={["Name", "Purpose", "Lasts"]}
            rows={[
              [<code key="n">an_aid</code>, "A random visitor ID to count returning visitors", "30 days"],
              [
                <code key="n">an_sid</code>,
                "A random ID that groups your page views into one visit. It is set before you make a choice, holds no other data and is not sent to anyone else.",
                "30 minutes",
              ],
            ]}
          />
          <Table
            caption="Advertising and attribution"
            head={["Name", "Purpose", "Lasts"]}
            rows={[
              [
                <code key="n">an_ft</code>,
                "How you first arrived: campaign tags in the link, ad-click IDs, the referring website and the first page you saw",
                "30 days",
              ],
              [<code key="n">an_lt</code>, "The same details for your most recent visit", "30 days"],
              [<code key="n">an_fts</code>, "A server-side copy of your first visit, used when you sign up", "1 year"],
            ]}
          />
          <p>
            When you sign up, and only if attribution is allowed, we save the first-visit details to your account. We use them to understand which
            channels bring people to {LEGAL.product}.
          </p>
        </>
      ),
    },
    {
      id: "storage",
      title: "Browser storage",
      body: (
        <>
          <p>The app also keeps some data in your browser&rsquo;s local and session storage:</p>
          <ul>
            <li>
              <strong>Needed for the app to work:</strong> unsent chat drafts, the chat and model you last used, panel sizes, theme, language,
              the open browser tab and sign-in progress (including, during sign-up, the email address you entered).
            </li>
            <li>
              <strong>Analytics and attribution:</strong> the same random visit IDs and first and last visit details as the cookies above. They
              follow the same choices you make for those categories.
            </li>
          </ul>
          <p>Clearing your browser&rsquo;s site data removes all of it.</p>
        </>
      ),
    },
    {
      id: "choices",
      title: "Your choices",
      body: (
        <>
          <H3>If you are in the EU or the EEA</H3>
          <p>
            We show a banner on your first visit. Analytics and attribution cookies are set only if you accept them. &ldquo;Reject all&rdquo;
            leaves only the strictly necessary ones.
          </p>
          <H3>Everywhere else</H3>
          <p>
            Analytics and attribution cookies are on by default. You can turn them off at any time.
          </p>
          <H3>How to change your choice</H3>
          <ul>
            <li>
              In the app: Settings → Account → Privacy &amp; data → Manage → <em>Cookie settings</em>.
            </li>
            <li>
              In your browser: block or delete cookies in its settings. If you block strictly necessary cookies, you won&rsquo;t be able to sign
              in.
            </li>
          </ul>
          <p>
            Some browsers send a &ldquo;Do Not Track&rdquo; signal. There&rsquo;s no agreed standard for it, so we don&rsquo;t respond to it.
            Because we don&rsquo;t track you across other websites, it would make no difference here.
          </p>
        </>
      ),
    },
    {
      id: "other",
      title: "Other technologies",
      body: (
        <p>
          Stock images in the app and on our home page load straight from Pexels, and mini-apps in the editor load code from jsDelivr and fonts
          from Google Fonts. These requests share your IP address with those services but don&rsquo;t set cookies on {LEGAL.host}. We
          don&rsquo;t use tracking pixels, session recording or fingerprinting.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes and contact",
      body: (
        <p>
          If we add a cookie or start sending analytics to an outside service, we will update this page first. Where your consent is needed, we
          will ask for it again. Questions: <Mail subject="Cookies" />.
        </p>
      ),
    },
  ],
};
