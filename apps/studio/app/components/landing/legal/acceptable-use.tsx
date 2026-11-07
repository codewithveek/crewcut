import { H3, type LegalDoc, Mail } from "./legal-page";
import { LEGAL } from "./legal-info";

export const acceptableUseDoc: LegalDoc = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  intro: (
    <p>
      {LEGAL.product} gives you an AI crew that can write, voice and publish. This policy sets out what you may not use it for. It is part of
      our <a href="/terms">Terms of Service</a> and applies to everything you create, upload, share or publish with {LEGAL.product}.
    </p>
  ),
  sections: [
    {
      id: "illegal",
      title: "Illegal and seriously harmful content",
      body: (
        <>
          <p>Don&rsquo;t use {LEGAL.product} to create, upload, share or publish content that:</p>
          <ul>
            <li>
              sexualises minors in any way. We report child sexual abuse material to the authorities and to the National Center for Missing &amp;
              Exploited Children (NCMEC);
            </li>
            <li>is sexual content involving anyone without their consent, including intimate images or &ldquo;deepfakes&rdquo; of real people;</li>
            <li>threatens, incites or glorifies violence, terrorism or violent extremism;</li>
            <li>harasses, bullies, doxxes or intimidates anyone, or attacks people for a protected characteristic such as race, ethnicity, religion, disability, sex, sexual orientation or gender identity;</li>
            <li>encourages self-harm or suicide, or gives instructions for it;</li>
            <li>gives real help with making weapons capable of mass harm (biological, chemical, nuclear or radiological), or with other serious crimes;</li>
            <li>is illegal where you are or where you publish it, or helps others break the law.</li>
          </ul>
        </>
      ),
    },
    {
      id: "deception",
      title: "Deception and impersonation",
      body: (
        <>
          <ul>
            <li>
              Don&rsquo;t impersonate a real person or organisation, or present synthetic media of a real person as genuine. That includes their
              face, likeness or voice. Use a real person&rsquo;s voice or likeness only with their permission.
            </li>
            <li>
              Don&rsquo;t make content designed to mislead people about elections or voting, public health, emergencies or other matters where
              deception causes real harm.
            </li>
            <li>Don&rsquo;t use {LEGAL.product} for scams, fraud, phishing, fake reviews or fake testimonials.</li>
            <li>
              Don&rsquo;t remove or fake the source links the fact-check shows in order to make a claim look supported when it isn&rsquo;t.
            </li>
            <li>
              Label realistic AI-generated or altered content where the law or the platform you publish on requires it.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "rights",
      title: "Other people's rights",
      body: (
        <ul>
          <li>
            Don&rsquo;t upload or publish material you don&rsquo;t have the rights to use. That includes music, footage, images, fonts, logos and
            other people&rsquo;s writing.
          </li>
          <li>
            Don&rsquo;t share other people&rsquo;s private information, such as contact details, ID documents, financial or health information,
            without a lawful basis.
          </li>
          <li>
            Don&rsquo;t ask the crew to fetch and republish other people&rsquo;s content wholesale. Quote and cite it, and follow the source&rsquo;s
            terms.
          </li>
        </ul>
      ),
    },
    {
      id: "platform",
      title: "Using the service fairly",
      body: (
        <>
          <p>Don&rsquo;t:</p>
          <ul>
            <li>
              try to get into accounts, data or systems that aren&rsquo;t yours, or probe, scan or test {LEGAL.product}&rsquo;s security without our
              written permission (see section 6 for reporting a vulnerability);
            </li>
            <li>
              use {LEGAL.product} to attack, scan or overload other systems. That includes pointing the research tools at private or internal
              network addresses;
            </li>
            <li>upload malware, or content built to manipulate the AI crew into acting against another user (prompt injection);</li>
            <li>
              get around usage limits, safety measures or access controls, for example by creating accounts to avoid limits or a suspension;
            </li>
            <li>scrape the service or collect data from it automatically, except through features we provide for that;</li>
            <li>send spam, or use publishing features for bulk, repetitive or misleading uploads that break the platform&rsquo;s rules;</li>
            <li>resell or rebrand access to the hosted service without our written agreement;</li>
            <li>use {LEGAL.product} in a way that breaks the rules of a connected service, for example YouTube&rsquo;s Community Guidelines.</li>
          </ul>
        </>
      ),
    },
    {
      id: "enforcement",
      title: "What happens if this policy is broken",
      body: (
        <>
          <p>Depending on how serious it is, we may:</p>
          <ul>
            <li>warn you;</li>
            <li>remove content, or switch off a share link;</li>
            <li>limit features, or suspend or close the account;</li>
            <li>report illegal content or activity to the authorities when the law requires it or when someone is at risk of harm.</li>
          </ul>
          <p>
            Where it is reasonable and lawful, we will tell you what we did and why. If you think we got it wrong, reply to our message or email{" "}
            <Mail subject="Appeal" /> and a person will look at it again.
          </p>
        </>
      ),
    },
    {
      id: "report",
      title: "Reporting",
      body: (
        <>
          <H3>Illegal content or abuse</H3>
          <p>
            To report a shared video or other content that you believe is illegal or breaks this policy, email <Mail subject="Report" />. Tell us
            where it is (the link), why you think it is illegal or breaks this policy, and your name and email, unless the report concerns child
            sexual abuse material, which you may report anonymously. We confirm that we received your report, review it promptly and tell you
            what we decided. For copyright complaints, follow the steps in section 10 of the <a href="/terms#copyright">Terms</a>.
          </p>
          <p>
            The same address is our single point of contact for users and for authorities, including under the EU Digital Services Act. You can
            write to it in English.
          </p>
          <H3>Security problems</H3>
          <p>
            If you find a security vulnerability, email <Mail subject="Security" /> with the details. Give us reasonable time to fix it before you
            tell anyone else. Don&rsquo;t access, change or delete other people&rsquo;s data while testing. We won&rsquo;t take legal action
            against good-faith research that follows these rules.
          </p>
        </>
      ),
    },
  ],
};
