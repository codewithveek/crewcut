import { Callout, Ext, H3, type LegalDoc, Mail, Table } from "./legal-page";
import { LEGAL } from "./legal-info";

const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const GOOGLE_PERMISSIONS = "https://security.google.com/settings/security/permissions";
const GOOGLE_USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";

export const privacyDoc: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  intro: (
    <>
      <p>
        This policy explains what personal data {LEGAL.product} collects when you visit {LEGAL.host} or use the {LEGAL.product} app, why we collect
        it, who we share it with, how long we keep it and the rights you have over it.
      </p>
    </>
  ),
  summary: [
    <>We collect what we need to run your account and make your videos: your name and email, the media and text you add, and basic security records such as your IP address.</>,
    <>We don't sell your data, we don't show ads, and we don't use your content to train AI models.</>,
    <>When you use the AI crew, voice-overs or YouTube, the content involved goes to the model provider you choose, to ElevenLabs or to Google. Each receives only what it needs for that task.</>,
    <>Files you upload are stored at long, random web addresses. Anyone who has the exact address of a file can open it.</>,
    <>You can ask for a copy of your data, or ask us to correct or delete it, from Settings or by emailing {LEGAL.email}.</>,
  ],
  sections: [
    {
      id: "who-we-are",
      title: "Who we are",
      body: (
        <>
          <p>
            {LEGAL.product} is operated by {LEGAL.operator}, an individual based in {LEGAL.country} (&ldquo;{LEGAL.product}&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;). For the personal data described in this policy we are the <strong>data controller</strong>:
            we decide why and how it is processed.
          </p>
          <p>
            Contact for anything in this policy, including requests to use your rights: <Mail subject="Privacy" />.
          </p>
        </>
      ),
    },
    {
      id: "scope",
      title: "What this policy covers",
      body: (
        <>
          <p>This policy applies to:</p>
          <ul>
            <li>
              the public website at <Ext href={LEGAL.site}>{LEGAL.host}</Ext>, including the template gallery and pages for videos shared with a
              link;
            </li>
            <li>the {LEGAL.product} app you use after signing in, including the AI crew, the editor and its mini-apps;</li>
            <li>emails and messages you send us.</li>
          </ul>
          <p>
            It does not cover services you connect to {LEGAL.product}, such as Google or your AI model provider. They handle your data under their
            own policies. {LEGAL.product}&rsquo;s source code is open source; if someone else runs their own copy of it, that operator, not us, is
            responsible for the data it holds.
          </p>
        </>
      ),
    },
    {
      id: "data-we-collect",
      title: "The data we collect",
      body: (
        <>
          <H3>Data you give us</H3>
          <ul>
            <li>
              <strong>Account details:</strong> your name, email address and password. We store the password only as a one-way hash, never in
              readable form. If you turn on two-step sign-in, we also store its secret and your backup codes.
            </li>
            <li>
              <strong>Your content:</strong> projects, video briefs, scripts, edits, captions, templates you save and the text the crew writes for
              you. It also includes the files you upload (video, audio, images and recordings) and anything those files show or contain, such as
              people&rsquo;s faces and voices.
            </li>
            <li>
              <strong>Research sources:</strong> web addresses you ask the crew to read, the text it fetches from them, and notes or documents you
              paste. Before we store this text, we automatically remove things that look like passwords and API keys.
            </li>
            <li>
              <strong>Conversations with the AI crew:</strong> your chat messages and the crew&rsquo;s replies, the notes the crew saves to remember
              your preferences (&ldquo;learnings&rdquo;), and your approvals, overrides and comments on each stage of a video.
            </li>
            <li>
              <strong>Keys you save:</strong> if you add your own API key (for example for an AI model or for ElevenLabs), we store it encrypted
              with AES-256-GCM. We use it only to make the requests you ask for.
            </li>
            <li>
              <strong>Billing details (paid plans only):</strong> if you buy a paid plan, your name, email address and billing country, the plan
              you chose, and a record of each payment (amount, currency, date and status). You enter your payment details on the checkout of
              our payment provider, Bachs. We never receive or store your full card number.
            </li>
            <li>
              <strong>Teams and sharing:</strong> the email addresses of people you invite to a team or share an item with.
            </li>
            <li>
              <strong>Messages to us:</strong> what you write when you contact support or make a privacy request, and our replies.
            </li>
          </ul>

          <p>
            To create an account you must give a name, an email address and a password. Everything else is up to you, but some features need
            it: the crew can&rsquo;t write a script without a brief, for example, and publishing needs a connected YouTube channel.
          </p>

          <H3>Data we collect automatically</H3>
          <ul>
            <li>
              <strong>Sign-in records:</strong> for each signed-in session we store its start and expiry times, your IP address and your
              browser&rsquo;s user agent (a short text that names your browser and operating system). We use these to keep you signed in and
              to spot suspicious sign-ins.
            </li>
            <li>
              <strong>Server and security logs:</strong> when your browser loads a page or file, our hosting provider records technical details
              such as your IP address, the address requested, the time and your user agent. We use these to run the service, fix faults and block
              abuse.
            </li>
            <li>
              <strong>AI crew usage records:</strong> for each crew run we record which tools ran, whether they succeeded, how long they took, how
              many tokens they used, an estimated cost, short error summaries, and any thumbs-up or thumbs-down you give. These records do not
              include the text of your prompts or of the crew&rsquo;s answers. Those are kept in your chat history instead.
            </li>
            <li>
              <strong>Cookies and browser storage:</strong> see section 12 and our <a href="/cookies">Cookie Policy</a>.
            </li>
            <li>
              <strong>Where you came from:</strong> if you allow it (see the Cookie Policy), we save how you first reached {LEGAL.product} to your
              account when you sign up: campaign tags in the link (&ldquo;UTM&rdquo; parameters), ad-click identifiers and the name of the website
              that referred you, but not the full address of the page you were on.
            </li>
          </ul>

          <H3>Data from services you connect</H3>
          <ul>
            <li>
              <strong>YouTube:</strong> if you connect a YouTube channel, we receive the data described in section 6.
            </li>
            <li>
              <strong>Your AI model provider:</strong> the replies its models send back to the crew.
            </li>
            <li>
              <strong>ElevenLabs:</strong> the voice-over and music audio it generates for your videos.
            </li>
            <li>
              <strong>Pexels:</strong> the stock photos and clips you choose, with the photographer&rsquo;s name and the licence details.
            </li>
          </ul>

          <H3>Data about other people</H3>
          <p>
            If your videos, sources or uploads include other people, for example their image, voice or words, you are responsible for having the
            right to use that material. Our <a href="/terms">Terms</a> and <a href="/acceptable-use">Acceptable Use Policy</a> say more about this.
          </p>
        </>
      ),
    },
    {
      id: "how-we-use",
      title: "How we use your data, and our legal bases",
      body: (
        <>
          <p>
            Data protection laws, including the GDPR, the UK GDPR and Nigeria&rsquo;s Data Protection Act 2023, require a lawful basis for each
            use. Ours are:
          </p>
          <Table
            caption="Purposes and lawful bases"
            head={["Purpose", "Data used", "Lawful basis"]}
            rows={[
              [
                "Create and run your account, and keep you signed in",
                "Account details, sign-in records, essential cookies",
                "Performing our contract with you (the Terms)",
              ],
              [
                "Make, edit, store, render and share your videos, and run the AI crew, voice-overs and publishing you ask for",
                "Your content, sources, conversations, connected-service data",
                "Performing our contract with you",
              ],
              [
                "Keep the service secure, prevent abuse and fraud, and fix faults",
                "Sign-in records, server logs, usage records",
                "Our legitimate interest in a safe, working service",
              ],
              [
                "Understand how the service is used so we can improve it, using counts and summaries rather than your content",
                "Usage records, analytics cookies",
                "Legitimate interests. For analytics cookies: consent in the EU and EEA, legitimate interests elsewhere (you can opt out)",
              ],
              [
                "Know which links and campaigns bring people to Crewcut",
                "Attribution cookies and the sign-up attribution fields",
                "Consent in the EU and EEA; legitimate interests elsewhere (you can opt out)",
              ],
              [
                "Take payment for paid plans, and keep billing and tax records",
                "Billing details",
                "Performing our contract; legal obligation for tax and accounting records",
              ],
              [
                "Answer your messages and privacy requests",
                "Messages, account details",
                "Performing our contract; legal obligation for rights requests",
              ],
              [
                "Tell you about important changes to the service or these policies",
                "Email address",
                "Performing our contract; legitimate interests",
              ],
              [
                "Comply with the law, enforce our Terms and defend legal claims",
                "Any relevant data",
                "Legal obligation; legitimate interests",
              ],
            ]}
          />
          <p>
            Where we rely on legitimate interests, we have weighed them against your rights, and you can object (see section 11). Where we rely on
            consent, you can withdraw it at any time. Withdrawing consent doesn&rsquo;t affect what we did before.
          </p>
          <p>
            <strong>What we don&rsquo;t do:</strong> we don&rsquo;t sell or rent your personal data. We don&rsquo;t share it for targeted advertising,
            we don&rsquo;t show ads, and we don&rsquo;t use your content to train AI models. We don&rsquo;t make decisions about you
            that have legal or similarly significant effects by automated means alone.
          </p>
          <p>
            We send email about your account or the service only when it is needed, and no marketing email unless you have agreed to it.
          </p>
        </>
      ),
    },
    {
      id: "ai",
      title: "The AI crew and your content",
      body: (
        <>
          <p>
            {LEGAL.product}&rsquo;s crew is made of AI agents that research, write, edit, voice and check your videos. To do that, the crew sends
            the material for a task to an AI model provider. This includes your instructions, the chat, your brief and script, source text, project
            details, and descriptions of your timeline and media.
          </p>
          <ul>
            <li>
              <strong>You choose the provider.</strong> You connect a model in Settings, using your own account with that provider or a connection
              we offer there. The providers that can be connected include Anthropic, OpenAI, Google (Gemini), OpenRouter, Groq, Mistral, Cohere,
              Builder.io and Ollama servers you run yourself. The provider handles the content under its terms and privacy policy and under your
              agreement with it.
            </li>
            <li>
              <strong>If we ever supply the model for you</strong>, we will name that provider on this page before it receives any of your data.
            </li>
            <li>
              <strong>Not for training by us.</strong> We don&rsquo;t use your content to train or fine-tune AI models. What a provider may do
              with what it receives is set by its terms and, for your own provider account, by your settings there. Check them if this matters to
              you.
            </li>
            <li>
              <strong>Mistakes are possible.</strong> AI output can be wrong even when it cites a source. Review it before you publish.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "youtube",
      title: "YouTube and Google data",
      body: (
        <>
          <p>
            {LEGAL.product} uses <strong>YouTube API Services</strong> to publish your videos to YouTube and to show how they perform. This is
            optional. It only happens if you connect a YouTube channel on the Connections page (Connect in the sidebar) and approve access on Google&rsquo;s consent
            screen. By connecting, you also agree to the{" "}
            <Ext href="https://www.youtube.com/t/terms">YouTube Terms of Service</Ext>, and Google handles your data under the{" "}
            <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>.
          </p>
          <H3>What we access</H3>
          <p>We ask Google for three permissions:</p>
          <ul>
            <li>
              <strong>Upload videos</strong> (<code>youtube.upload</code>): to upload a video to your channel. We do this only when you approve a
              publish, with the title, description and privacy setting you confirm.
            </li>
            <li>
              <strong>View your YouTube account</strong> (<code>youtube.readonly</code>): to show which channel is connected, and to read the
              details of videos you published through {LEGAL.product}.
            </li>
            <li>
              <strong>View YouTube Analytics reports</strong> (<code>yt-analytics.readonly</code>): to read performance figures, such as views,
              watch time and audience retention, for videos you published through {LEGAL.product}.
            </li>
          </ul>
          <H3>What we store and how we use it</H3>
          <ul>
            <li>
              The <strong>access and refresh tokens</strong> Google gives us. We store them encrypted (AES-256-GCM), use them only for the actions
              above, and never show them to anyone, including you.
            </li>
            <li>Your channel&rsquo;s name and ID, and the permissions you granted.</li>
            <li>For each video you publish, its YouTube ID and link, and the title, description and privacy setting we sent.</li>
            <li>
              Snapshots of the performance figures for those videos, and the summaries the crew writes from them. You can see these in{" "}
              {LEGAL.product}.
            </li>
          </ul>
          <p>
            We use this data only to provide the publishing and performance features you see in {LEGAL.product}. When you ask the crew to explain
            how a video performed, the figures go to the AI model provider you connected (see section 5), only to answer your request. We
            don&rsquo;t sell YouTube data, use it for advertising, or use it to train AI models. We don&rsquo;t share it with anyone else, except
            our hosting providers, who store it for us (section 7).
          </p>
          <Callout>
            <p>
              {LEGAL.product}&rsquo;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
              <Ext href={GOOGLE_USER_DATA_POLICY}>Google API Services User Data Policy</Ext>, including the Limited Use requirements.
            </p>
          </Callout>
          <H3>Disconnecting and deletion</H3>
          <ul>
            <li>
              <strong>In {LEGAL.product}:</strong> disconnect the channel on the Connections page. We revoke our access with Google and straight
              away delete the tokens, the channel details, the stored performance figures, the summaries the crew wrote from them and the
              learnings it saved from those summaries. Figures the crew quoted in a chat stay in that chat until you delete it. The record that a
              video was published, with its YouTube link, stays in that video&rsquo;s history until you delete the video. Email us if you want
              either removed sooner, and we will do it within 7 days.
            </li>
            <li>
              <strong>In your Google Account:</strong> you can also remove {LEGAL.product}&rsquo;s access at any time on Google&rsquo;s{" "}
              <Ext href={GOOGLE_PERMISSIONS}>security settings page</Ext>. We then lose access at once. We check every connection with Google
              regularly, and when we find that access was revoked we delete the tokens and the YouTube data listed above, in any case within 30
              days of the revocation.
            </li>
            <li>
              While you stay connected, we confirm with Google at least every 30 days that you still authorise {LEGAL.product}, and we keep
              stored YouTube data only as long as the YouTube API Services policies allow.
            </li>
            <li>Videos already on your channel stay there. Manage or delete them in YouTube.</li>
          </ul>
          <p>
            Questions or complaints about how we handle YouTube data: <Mail subject="YouTube data" />.
          </p>
        </>
      ),
    },
    {
      id: "sharing",
      title: "Who we share data with",
      body: (
        <>
          <H3>Service providers</H3>
          <p>
            These companies process data on our behalf, under contracts that require them to protect it and to use it only to provide their
            service to us:
          </p>
          <Table
            caption="Service providers we use"
            head={["Provider", "What they do for us", "Data involved"]}
            rows={[
              [
                "Cloudflare, Inc.",
                "Runs our servers, network, domain and security protection, and stores files (uploads, voice-overs, exported videos)",
                "All data passing through the app, including files, IP addresses and logs",
              ],
              ["Timescale, Inc. (on Amazon Web Services)", "Hosts our database", "Account details, content records, conversations, usage records"],
              [
                "ElevenLabs, Inc.",
                "Generates voice-overs when you ask for them (with our key, unless you add your own)",
                "The text to be spoken and the voice you chose",
              ],
              [
                "Pexels (part of Canva)",
                "Stock photo and video search, and the stock images on our pages",
                "Your search words, sent from our servers. Stock images in the app and on our home page load straight from Pexels, so your browser sends it your IP address.",
              ],
              [
                "Bachs Technologies Limited (Nigeria)",
                <>
                  Processes payments for paid plans. For fraud prevention and financial-crime checks it acts as an independent controller under
                  its own <Ext href="https://bachs.io/privacy">privacy policy</Ext>
                </>,
                "Your name, email, billing details, the payment details you enter at checkout, and payment records",
              ],
              ["Our email provider", "Receives and stores email you send us", "Your email address and your messages"],
            ]}
          />
          <H3>Services you choose to connect</H3>
          <p>
            When you connect your AI model provider, ElevenLabs with your own key, or YouTube, we send them what is needed to do what you ask, as
            described in sections 5 and 6. Their own terms and privacy policies apply.
          </p>
          <H3>Mini-apps</H3>
          <p>
            Mini-apps that run inside the editor load code from <strong>jsDelivr</strong> and fonts from <strong>Google Fonts</strong>, so your
            browser sends your IP address to those services when a mini-app opens.
          </p>
          <H3>People you share with</H3>
          <ul>
            <li>Items you share with a team or with specific people become visible to them.</li>
            <li>
              If you set a video to <strong>&ldquo;Anyone with the link&rdquo;</strong>, anyone who has the link can watch its latest export and
              see its title, without signing in. Your name and email aren&rsquo;t shown. Make the video private again to remove access.
            </li>
          </ul>
          <H3>Other cases</H3>
          <ul>
            <li>
              <strong>Legal reasons:</strong> when the law requires it, for example a valid court order, or when needed to protect someone&rsquo;s
              safety or to defend our rights. Where the law allows, we will tell you first.
            </li>
            <li>
              <strong>A change of ownership:</strong> if {LEGAL.product} is sold, merged or transferred, your data may pass to the new operator. That
              operator must honour this policy, or tell you and give you the chance to delete your data first.
            </li>
            <li>
              <strong>With your consent:</strong> in any other case, only if you ask us to or agree to it.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "transfers",
      title: "International transfers",
      body: (
        <>
          <p>
            We are based in {LEGAL.country}. Our providers run services in many countries, including the United States and the European Union, so
            your data may be processed outside your country.
          </p>
          <p>When we transfer personal data across borders, we rely on legally recognised safeguards:</p>
          <ul>
            <li>adequacy decisions, where they exist;</li>
            <li>the European Commission&rsquo;s Standard Contractual Clauses and the UK&rsquo;s equivalent, offered in our providers&rsquo; data processing terms;</li>
            <li>for transfers out of Nigeria, the conditions in Part VIII of the Nigeria Data Protection Act 2023.</li>
          </ul>
          <p>You can ask us for details of these safeguards.</p>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long we keep data",
      body: (
        <>
          <Table
            caption="Retention periods"
            head={["Data", "How long"]}
            rows={[
              ["Account details, content, conversations and saved keys", "Until you delete them or your account. Deleting a video or file removes it from the app straight away."],
              [
                "Media still used by another of your videos",
                "Deleting one video keeps media your other videos still use. It moves to your library until you delete it there.",
              ],
              ["Sign-in sessions (including IP address and user agent)", "A session ends after 30 days without use, or when you sign out. Records of past sessions may stay with your account until it is deleted."],
              ["Server and security logs", "Normally a few days, and no longer than 30 days unless needed to investigate abuse"],
              ["Detailed AI crew run records", "30 days"],
              ["Your ratings of the crew's work, and run totals", "As long as your account exists"],
              ["YouTube data", "As described in section 6"],
              ["Billing and payment records", "As long as tax and accounting laws require, usually six years after the payment"],
              ["Support messages", "Until the issue is resolved, then up to 2 years in case it comes up again"],
              ["Records of privacy requests", "Up to 3 years, to show we handled them"],
            ]}
          />
          <p>
            When you ask us to delete your account, we delete or anonymise your personal data within 30 days. Copies in backups are overwritten on a
            rolling schedule and are gone within 90 days. We may keep some data longer where the law requires it, or to settle a dispute or
            enforce our Terms, and only for that purpose.
          </p>
        </>
      ),
    },
    {
      id: "security",
      title: "Security",
      body: (
        <>
          <p>We take reasonable technical and organisational steps to protect your data, including:</p>
          <ul>
            <li>encryption in transit (HTTPS) for all traffic to {LEGAL.host};</li>
            <li>encryption of saved API keys and connected-account tokens with AES-256-GCM;</li>
            <li>one-way hashing of passwords;</li>
            <li>access controls, so your projects are visible only to you and the people you share them with;</li>
            <li>automatic removal of passwords and keys from research text before it is stored.</li>
          </ul>
          <Callout>
            <p>
              <strong>About file links:</strong> uploaded and exported files are stored at long, random web addresses that can&rsquo;t realistically
              be guessed. They are not locked behind sign-in, so anyone who has a file&rsquo;s exact address can open it. Don&rsquo;t post those
              addresses publicly if you want a file kept private.
            </p>
          </Callout>
          <p>
            No system is perfectly secure. If a personal data breach puts your rights at risk, we will tell you and the relevant regulators when
            and as the law requires. Under the GDPR and the Nigeria Data Protection Act, regulators must normally be told within 72 hours.
          </p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>Wherever you live, you can ask us to:</p>
          <ul>
            <li>
              <strong>give you access</strong> to the personal data we hold about you, with a copy;
            </li>
            <li>
              <strong>correct</strong> data that is wrong or incomplete (you can change your name and email yourself in Settings → Account);
            </li>
            <li>
              <strong>delete</strong> your data or your whole account;
            </li>
            <li>
              <strong>give you your data in a portable format</strong>, or send it to another service where that&rsquo;s technically possible;
            </li>
            <li>
              <strong>restrict</strong> or <strong>object to</strong> certain uses, including any use based on legitimate interests;
            </li>
            <li>
              <strong>withdraw consent</strong> you gave, for example for attribution cookies.
            </li>
          </ul>
          <H3>How to make a request</H3>
          <p>
            In the app, go to Settings → Account → Privacy &amp; data → Manage and choose <em>Request a copy</em> or <em>Request deletion</em>. You can
            also email <Mail subject="Privacy request" /> from the address on your account. Either way, a person handles the request: we confirm
            by email that we received it, and we may need to check it&rsquo;s you before we act. Requests are free.
          </p>
          <p>
            We answer within one month. For complex requests we may extend this by up to two more months, and if we do, we will tell you why. If we
            can&rsquo;t do what you ask, for example because the law requires us to keep something, we will explain why.
          </p>

          <H3>If you are in the EU, the EEA or the UK</H3>
          <p>
            You have the rights above under the GDPR or the UK GDPR, and the right to complain to your local data protection authority. In the UK,
            that is the <Ext href="https://ico.org.uk/make-a-complaint/">Information Commissioner&rsquo;s Office</Ext>. We would like the chance to
            help first, so please contact us.
          </p>

          <H3>If you are in Nigeria</H3>
          <p>
            The Nigeria Data Protection Act 2023 gives you these rights, including the right not to be subject to decisions based solely on
            automated processing. You can complain to the{" "}
            <Ext href="https://ndpc.gov.ng">Nigeria Data Protection Commission</Ext>.
          </p>

          <H3>If you are in the United States</H3>
          <p>
            Depending on your state (for example California, Colorado, Connecticut, Virginia or Texas), you may have the rights to know, access,
            correct and delete your personal data, and to opt out of its &ldquo;sale&rdquo;, its &ldquo;sharing&rdquo; for targeted advertising,
            and profiling. We don&rsquo;t sell personal data or share it for targeted advertising, and we don&rsquo;t use sensitive personal data to
            infer things about you. You can use the rights that apply to you as described above, or through an authorised agent, and we will not
            treat you differently for doing so. If we turn down your request, you can appeal by replying to our answer. We will respond to the
            appeal within the time your state&rsquo;s law requires. {LEGAL.product} may be too small for these laws to apply to it, but we
            honour these rights for everyone.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies and similar technologies",
      body: (
        <>
          <p>
            We use cookies and browser storage to keep you signed in, remember your settings and choices, and, where allowed, measure visits and see
            which links bring people to {LEGAL.product}. We don&rsquo;t use advertising cookies from other companies. If you are in the EU or the
            EEA, we ask for your consent before setting cookies that aren&rsquo;t essential. Elsewhere they are on by default. Wherever you are,
            you can change your choice at any time in Settings → Account → Privacy &amp; data → Manage → <em>Cookie settings</em>.
          </p>
          <p>
            The <a href="/cookies">Cookie Policy</a> lists each cookie, its purpose and how long it lasts.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          {LEGAL.product} is not for anyone under {LEGAL.minimumAge}. We don&rsquo;t knowingly collect personal data from anyone under{" "}
          {LEGAL.minimumAge}. If you believe a child has given us personal data, contact <Mail subject="Child account" /> and we will delete it.
          If you are under 18, you may use {LEGAL.product} only with the consent of a parent or guardian where your local law requires it. In
          Nigeria, the Data Protection Act requires that consent for anyone under 18.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: (
        <p>
          We will update this policy when our practices change, for example when we add a provider. The date at the top shows when it last
          changed. If a change materially affects how we use your data, we will tell you by email or in the app before it takes effect. Where the
          law requires your consent, we will ask for it.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          {LEGAL.operator}, operator of {LEGAL.product}, {LEGAL.country}. Email: <Mail subject="Privacy" />.
        </p>
      ),
    },
  ],
};
