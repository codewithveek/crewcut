import { Callout, Ext, H3, type LegalDoc, Mail } from "./legal-page";
import { LEGAL } from "./legal-info";

export const termsDoc: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  intro: (
    <>
      <p>
        These terms are the agreement between you and {LEGAL.operator}, who operates {LEGAL.product} (&ldquo;{LEGAL.product}&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;). They cover your use of {LEGAL.host} and the {LEGAL.product} app. Please read them. By creating an
        account or using {LEGAL.product}, you agree to them.
      </p>
    </>
  ),
  summary: [
    <>You must be at least {LEGAL.minimumAge} to use {LEGAL.product}.</>,
    <>You own what you upload and the videos you make. You give us only the permission we need to run the service for you.</>,
    <>AI output can be wrong. Check it before you publish: you are responsible for what you publish.</>,
    <>Only use material you have the rights to, and follow the <a href="/acceptable-use">Acceptable Use Policy</a>.</>,
    <>{LEGAL.product} is free today. If we offer paid plans, you will see the price and terms before you pay.</>,
    <>Nothing in these terms takes away rights you have as a consumer under the law where you live.</>,
  ],
  sections: [
    {
      id: "agreement",
      title: "The agreement",
      body: (
        <>
          <p>
            These terms, together with the <a href="/acceptable-use">Acceptable Use Policy</a>, make up the whole agreement between you and us
            about {LEGAL.product}. Our <a href="/privacy">Privacy Policy</a> and <a href="/cookies">Cookie Policy</a> explain how we handle
            personal data. They are notices, not part of this contract. If you use {LEGAL.product} for an organisation, you confirm you are
            allowed to accept these terms for it, and &ldquo;you&rdquo; includes that organisation.
          </p>
        </>
      ),
    },
    {
      id: "eligibility",
      title: "Who can use Crewcut",
      body: (
        <ul>
          <li>
            You must be at least {LEGAL.minimumAge} years old. If you are under 18, you need the consent of a parent or guardian where your
            local law requires it (in Nigeria it does), and they agree to these terms for you.
          </li>
          <li>You must not be barred from using services like this under the laws that apply to you.</li>
          <li>You must not have had a {LEGAL.product} account closed by us for breaking these terms, unless we have agreed you can return.</li>
        </ul>
      ),
    },
    {
      id: "account",
      title: "Your account",
      body: (
        <>
          <p>
            Give accurate details when you sign up, and keep your sign-in details safe. Turning on two-step sign-in in Settings is a good idea.
            You are responsible for what happens under your account unless it happens because of our failure. Tell us straight away at{" "}
            <Mail subject="Account security" /> if you think someone else has used your account.
          </p>
          <p>
            If you invite people to a team, you are responsible for who you invite and for removing people who should no longer have access. Team
            owners and admins can see and change the team&rsquo;s shared items.
          </p>
        </>
      ),
    },
    {
      id: "service",
      title: "The service",
      body: (
        <>
          <p>
            {LEGAL.product} is a video editor with a crew of AI agents that can research, script, edit, voice and check your videos, and publish
            them to YouTube when you approve. We are improving it all the time, so features may change, be added or be removed. If we remove
            something important that you rely on, we will try to give you reasonable notice.
          </p>
          <p>
            Some features depend on other services, for example your AI model provider, ElevenLabs for voice, Pexels for stock media and YouTube
            for publishing. Section 8 covers them. Usage limits, such as file sizes (currently 100 MB per upload) and the amount of rendering,
            storage or AI use, may apply to keep the service fair and running. We show limits in the app where they apply.
          </p>
        </>
      ),
    },
    {
      id: "plans",
      title: "Free and paid plans",
      body: (
        <>
          <p>
            {LEGAL.product} is currently offered free of charge. We may offer paid plans in the future. Before you buy one, we will show you the
            price, what it includes, how often you will be billed and the payment provider, and you will have to agree to those details. Any
            plan-specific terms we show you then form part of this agreement.
          </p>
          <H3>If you buy a paid plan</H3>
          <ul>
            <li>
              <strong>Billing:</strong> paid plans are charged in advance for each billing period, through the payment provider named at checkout.
              We don&rsquo;t store your full card details.
            </li>
            <li>
              <strong>Renewal:</strong> subscriptions renew automatically at the end of each period until you cancel. We will remind you before an
              annual plan renews.
            </li>
            <li>
              <strong>Cancelling:</strong> you can cancel at any time, and the plan stays active until the end of the period you have paid for.
            </li>
            <li>
              <strong>Refunds:</strong> unless the law or the plan terms say otherwise, payments are non-refundable for periods that have already
              started. If {LEGAL.product} fails to work as described because of our fault, contact us and we will put it right or refund you
              fairly. If you are a consumer in the EU or the UK, you have a 14-day right to cancel. When you ask us to start the service straight
              away, you agree that you lose this right once the service has been fully provided, and if you cancel within the 14 days you pay
              for what you have used. We will ask for that request and acknowledgement at checkout and confirm it by email, with a form you can
              use to cancel.
            </li>
            <li>
              <strong>Price changes:</strong> we will tell you at least 30 days before a price change affects you, and you can cancel before it
              applies.
            </li>
            <li>
              <strong>Taxes:</strong> prices include or add taxes as shown at checkout.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "your-content",
      title: "Your content",
      body: (
        <>
          <p>
            &ldquo;Your content&rdquo; means everything you upload or create in {LEGAL.product}. That includes media, scripts, prompts, sources,
            templates and the videos you export, and the output the AI crew produces for you.
          </p>
          <ul>
            <li>
              <strong>You own it.</strong> As between you and us, you keep all rights you have in your content. We don&rsquo;t claim ownership of
              it, and we assign to you any rights we may have in the output the crew produces for you.
            </li>
            <li>
              <strong>The permission you give us.</strong> You give us a worldwide, non-exclusive, royalty-free licence to host, store, copy,
              process, adapt (for example to resize, transcode or render), display and transmit your content. This covers only what is needed to
              provide {LEGAL.product} to you and the people you share with, to keep it secure, and to send content to the services you direct us
              to, such as your AI model provider, ElevenLabs or YouTube. The licence ends when you delete the content or your account, apart from
              backups that expire on their normal schedule, copies you have already shared or published, and anything we must keep by law.
            </li>
            <li>
              <strong>No training, no ads.</strong> We don&rsquo;t use your content to train AI models, and we don&rsquo;t use it for advertising.
            </li>
            <li>
              <strong>You need the rights.</strong> You promise that you have every right, licence and consent needed for your content and for the
              way you use it. That includes rights to music, footage, logos and trademarks, and consent from people who can be identified,
              including for their voice. You also promise that your content doesn&rsquo;t break the law or the{" "}
              <a href="/acceptable-use">Acceptable Use Policy</a>.
            </li>
            <li>
              <strong>Sharing is your choice.</strong> If you make a video available to &ldquo;Anyone with the link&rdquo; or publish it, anyone with
              access can watch and may copy it. Uploaded and exported files are reachable by anyone who has their exact web address. We can&rsquo;t
              recall copies other people have already made.
            </li>
            <li>
              <strong>Keep your own copies.</strong> Download anything important. We work to keep your content safe, but we don&rsquo;t promise
              that {LEGAL.product} is a backup service.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "ai-output",
      title: "AI output",
      body: (
        <>
          <Callout>
            <p>
              The crew uses AI models. Their output can be inaccurate, incomplete, out of date, biased, or similar to output produced for other
              people. {LEGAL.product}&rsquo;s fact-check links claims to sources to help you review them, but it doesn&rsquo;t guarantee that a
              claim, or its source, is true.
            </p>
          </Callout>
          <ul>
            <li>Review scripts, facts, voice-overs and edits before you publish. You are responsible for what you publish and how you use it.</li>
            <li>Don&rsquo;t rely on AI output as professional advice, for example legal, medical or financial advice.</li>
            <li>
              Because similar prompts can produce similar results, other people may receive output like yours, and you may not have exclusive
              rights in it. Some countries may not protect purely AI-generated material by copyright.
            </li>
            <li>
              Where the law or a platform&rsquo;s rules require it, label realistic synthetic or altered media. For example, YouTube asks creators
              to disclose realistic altered or synthetic content.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "third-party",
      title: "Other services and content",
      body: (
        <>
          <H3>Services you connect</H3>
          <p>
            When you connect an AI model provider, ElevenLabs, YouTube or another service, you also enter into that provider&rsquo;s terms. Any fees
            they charge are between you and them, including charges on your own API keys. We aren&rsquo;t responsible for their services, their
            availability or what they do with data they receive under their own policies.
          </p>
          <H3>YouTube</H3>
          <p>
            {LEGAL.product}&rsquo;s publishing and performance features use YouTube API Services. By connecting a YouTube account, you agree to be
            bound by the <Ext href="https://www.youtube.com/t/terms">YouTube Terms of Service</Ext>. Google&rsquo;s handling of your data is
            covered by the <Ext href="https://policies.google.com/privacy">Google Privacy Policy</Ext>. Our <a href="/privacy#youtube">Privacy
            Policy</a> explains what we access and how to revoke access.
          </p>
          <H3>Stock media, music and templates</H3>
          <ul>
            <li>
              Photos and clips from Pexels are provided under the <Ext href="https://www.pexels.com/license/">Pexels License</Ext>. Don&rsquo;t
              suggest that people shown in them endorse you or your product, and don&rsquo;t sell them unaltered.
            </li>
            <li>
              The templates, music and other media we include in {LEGAL.product} are licensed to you for use within videos you make with{" "}
              {LEGAL.product}, including publishing those videos anywhere. You may not extract and redistribute them on their own, for example as
              a sound or template pack.
            </li>
            <li>
              Some media is owned by third parties and comes with their own licence terms, which we show in the app where they differ. You are
              responsible for following them.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <p>
          You must follow the <a href="/acceptable-use">Acceptable Use Policy</a>, which forms part of these terms. In short: no illegal content, no
          content that harms or deceives people, no infringing other people&rsquo;s rights, and no abusing or attacking the service.
        </p>
      ),
    },
    {
      id: "copyright",
      title: "Copyright and takedown requests",
      body: (
        <>
          <p>
            We respect intellectual property rights. If you believe content on {LEGAL.product}, such as a shared video, infringes your copyright or
            other rights, email <Mail subject="Copyright notice" /> with:
          </p>
          <ol>
            <li>your name and contact details, and your signature (typing your full name is enough);</li>
            <li>the work you say is infringed;</li>
            <li>the link or location of the content you object to on {LEGAL.product};</li>
            <li>a statement that you believe in good faith that the use is not authorised by the rights holder, its agent or the law;</li>
            <li>
              a statement that the information in your notice is accurate and that you are the rights holder or authorised to act for them. Make
              this statement under penalty of perjury where that applies to you.
            </li>
          </ol>
          <p>
            We will act quickly on valid notices, which can include removing or disabling access to the content. Where appropriate, we will tell
            the person who posted it. If your content was removed and you believe that was a mistake, you can send a counter-notice to the same
            address explaining why. We close the accounts of people who repeatedly infringe. Knowingly sending a false notice may make you liable
            for damages.
          </p>
        </>
      ),
    },
    {
      id: "our-rights",
      title: "Our rights in Crewcut",
      body: (
        <>
          <p>
            We and our licensors own {LEGAL.product}&rsquo;s service, design, brand, logo and the media we provide. Apart from the rights these terms
            give you, you get no rights in them. You may not use the {LEGAL.product} name or logo in a way that suggests we endorse you without our
            written permission.
          </p>
          <p>
            {LEGAL.product}&rsquo;s source code is published under the Apache License 2.0, and that licence governs your use of the code.
            It doesn&rsquo;t give you rights in the {LEGAL.product} name or logo, or in the hosted service at {LEGAL.host}. If you run your own copy
            of the code, these terms don&rsquo;t apply to it, and you are responsible for it.
          </p>
          <p>
            If you send us ideas or feedback, we may use them without owing you anything, but we will never claim ownership of your content
            because of feedback you gave.
          </p>
        </>
      ),
    },
    {
      id: "termination",
      title: "Ending this agreement",
      body: (
        <>
          <ul>
            <li>
              <strong>You</strong> can stop using {LEGAL.product} at any time. To ask us to delete your account and its data, go to Settings →
              Account → Privacy &amp; data → Manage and choose <em>Request deletion</em>, or email <Mail subject="Delete my account" />. We
              complete deletion within 30 days, as the <a href="/privacy#retention">Privacy Policy</a> describes.
            </li>
            <li>
              <strong>We</strong> may suspend or close your account, or remove content, if you seriously or repeatedly break these terms, if the law
              requires it, or if your use creates a risk of harm or legal liability for others or for us. Where it is reasonable and lawful, we will
              tell you first, explain why and give you a chance to fix the problem or to download your content.
            </li>
            <li>
              We may stop offering {LEGAL.product} altogether. If we do, we will give you at least 30 days&rsquo; notice so you can download your
              content, and we will refund any part of a paid period you won&rsquo;t be able to use.
            </li>
          </ul>
          <p>
            Sections that by their nature should continue after the agreement ends will continue. These include your content warranties, our
            rights, disclaimers, limits on liability, indemnity and the law that applies.
          </p>
        </>
      ),
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      body: (
        <>
          <p>
            We provide {LEGAL.product} with reasonable care and skill. Beyond that, to the extent the law allows, {LEGAL.product} is provided
            &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without other warranties, express or implied. Those include warranties of
            merchantability, fitness for a particular purpose, non-infringement, and that the service will be uninterrupted or error-free. We
            don&rsquo;t promise particular results, for example views, revenue or reach for your videos.
          </p>
          <p>Your rights as a consumer are not affected. See sections 17 and 18.</p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Limits on liability",
      body: (
        <>
          <p>To the extent the law allows:</p>
          <ul>
            <li>
              We are not liable for indirect, incidental, special or consequential losses, or for loss of profits, revenue, business opportunity,
              goodwill or data, if those losses were not a reasonably foreseeable result of our breach.
            </li>
            <li>
              Our total liability to you for all claims about {LEGAL.product} is limited to the greater of (a) the amount you paid us for{" "}
              {LEGAL.product} in the 12 months before the event that caused the claim, and (b) 100 US dollars.
            </li>
          </ul>
          <p>
            Nothing in these terms limits liability that the law does not allow to be limited. That includes liability for death or personal injury
            caused by negligence, for gross negligence or wilful misconduct, for fraud or fraudulent misrepresentation, or for breaching your
            statutory consumer rights.
          </p>
        </>
      ),
    },
    {
      id: "indemnity",
      title: "Your responsibility for claims",
      body: (
        <p>
          If someone brings a claim against us because of your content, or because you broke these terms or the law, you agree to cover our
          reasonable losses and costs from that claim, to the extent the law allows. This includes reasonable legal fees. We will tell you about
          the claim promptly and let you take part in the defence. This section applies only if you use {LEGAL.product} for business purposes.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          We may update these terms, for example when we add features or when the law changes. If a change is material, we will tell you by email
          or in the app at least 14 days before it takes effect. Changes needed for legal or security reasons may take effect sooner. If you
          don&rsquo;t agree to a change, you can stop using {LEGAL.product} and delete your account before it takes effect. If you keep using{" "}
          {LEGAL.product} after that, the new terms apply. The date at the top shows the current version.
        </p>
      ),
    },
    {
      id: "law",
      title: "The law that applies and disputes",
      body: (
        <>
          <p>
            These terms are governed by the laws of the Federal Republic of {LEGAL.country}. If you have a problem, please contact us first at{" "}
            <Mail subject="Complaint" />. We will try to resolve it within 30 days. If we can&rsquo;t, the courts of {LEGAL.country} have
            jurisdiction over any dispute about these terms or {LEGAL.product}.
          </p>
          <p>
            <strong>If you are a consumer</strong>, you keep the protection of the mandatory laws of the country where you live, such as consumer
            protection laws, and you may bring proceedings in the courts there. In {LEGAL.country}, that includes your rights under the Federal
            Competition and Consumer Protection Act 2018.
          </p>
        </>
      ),
    },
    {
      id: "general",
      title: "General",
      body: (
        <ul>
          <li>
            <strong>Your rights as a consumer</strong> under the law where you live always take priority over anything in these terms that
            conflicts with them.
          </li>
          <li>
            <strong>Transfer:</strong> you may not transfer this agreement without our consent. We may transfer it to whoever takes over{" "}
            {LEGAL.product}, as long as your rights under it are not reduced.
          </li>
          <li>
            <strong>Severability:</strong> if a court finds part of these terms unenforceable, the rest stays in effect.
          </li>
          <li>
            <strong>No waiver:</strong> if we don&rsquo;t enforce a right straight away, we can still enforce it later.
          </li>
          <li>
            <strong>Events beyond control:</strong> neither of us is responsible for delays or failures caused by events outside our reasonable
            control.
          </li>
          <li>
            <strong>Notices:</strong> we will send notices to the email address on your account or show them in the app. You can send notices to{" "}
            <Mail />.
          </li>
          <li>
            <strong>Language:</strong> these terms are written in English. If a translation conflicts with the English version, the English
            version applies, unless the law says otherwise.
          </li>
        </ul>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          {LEGAL.operator}, operator of {LEGAL.product}, {LEGAL.country}. Email: <Mail />.
        </p>
      ),
    },
  ],
};
