/**
 * 服务条款、隐私政策、风险披露的样板正文（v2 需求 4.3、第 10 节 F2-6）。
 * - PM 参照同类平台这类文件的通常结构，为 Quick Come 原创撰写，没有照抄任何竞品原文；页面顶部标"需法务审核"。
 * - 只写系统真实做到的（USDT 充提、三条链、最小充值、KYC、白名单、冷静期、人工审核、逐仓、强平、通知渠道、不用第三方统计）；
 *   不写牌照、监管、公司主体，这些位置写"待提供"。
 * - 中英文的章节数必须一致，英文里不能有中文（legal.test.ts 检查）。数字（2 小时、24 小时、3,000 USDT 等）和
 *   《v1-需求说明书》4.4 一致，后台改了参数时要同步改这里。
 */
import type { Lang } from '../i18n/lang';
import type { LegalPage } from '../lib/route';

export interface LegalSection {
  h: string;
  p: string[];
}

export interface LegalDoc {
  title: string;
  intro: string[];
  sections: LegalSection[];
}

/** 样板的更新日期 */
export const LEGAL_UPDATED = '2026-10-16';

const termsZh: LegalDoc = {
  title: '服务条款',
  intro: [
    '本服务条款（以下简称"本条款"）适用于你对 Quick Come 网站、客户端及相关服务（以下统称"本服务"）的使用。注册账户或使用本服务，即表示你已阅读、理解并同意本条款；如果不同意，请不要注册或使用本服务。',
    '本服务的运营主体、注册地、适用法律和争议解决方式：待提供。',
  ],
  sections: [
    {
      h: '1. 服务内容',
      p: [
        '本服务是以 USDT 作为保证金和结算货币的差价合约（CFD）交易平台。你可以通过本服务充值 USDT，交易外汇、贵金属、指数、能源、加密货币等品种的差价合约，并把账户余额提现为 USDT。',
        '差价合约不会让你取得任何标的资产的所有权，也不涉及实物交割。',
        '本服务不提供投资建议、资产管理或代客交易。网站和客户端上的任何内容都不构成对任何交易的推荐。',
      ],
    },
    {
      h: '2. 使用资格',
      p: [
        '你必须年满 18 周岁（或你所在地法律规定的成年年龄，以较高者为准），并具有完全民事行为能力。',
        '你有责任确认使用本服务符合你所在国家或地区的法律。在法律禁止差价合约交易或禁止使用本服务的地区，请不要使用本服务。',
        '每人只能注册一个账户，账户只能由本人使用，不得出借、转让或出售。',
      ],
    },
    {
      h: '3. 账户和安全',
      p: [
        '注册时需要用邮箱接收验证码，并设置符合要求的密码。你提供的资料必须真实、准确、完整，资料变化时请及时更新。',
        '请妥善保管你的密码和邮箱。通过你的账户进行的操作视为你本人的操作。发现账户异常时，请立即修改密码并联系我们。',
        '连续多次输错密码时，账户会被暂时锁定。',
      ],
    },
    {
      h: '4. 身份认证（KYC）',
      p: [
        '提现前必须完成身份认证：提交证件信息和照片，经人工审核通过。注册、充值和交易不要求先完成身份认证。',
        '审核中我们可能要求你补充资料；资料不真实、不完整或与账户信息不符时，我们可以驳回认证并说明原因。',
        '认证资料的处理方式见《隐私政策》。',
      ],
    },
    {
      h: '5. 充值',
      p: [
        '本服务只接受 USDT，支持 ERC20（以太坊）、TRC20（波场）和 BSC（BEP20）三个网络。每个账户有专属的充值地址。',
        '最小充值金额为 1 USDT，低于最小金额的转账不入账。',
        '请务必核对网络和代币。转错网络、转入 USDT 以外的代币或转到错误地址，资金可能无法找回，我们没有义务、也可能没有能力追回。',
        '充值在区块链确认数达到要求后自动入账。如果链上交易被回滚或被认定无效，我们会撤销对应的入账。',
      ],
    },
    {
      h: '6. 提现',
      p: [
        '提现需要同时满足：已完成身份认证；目标地址在你的提现白名单里，并且新加入的地址已过 24 小时生效期；金额在单笔和每日限额之内（以提现页面显示为准）。',
        '提现提交后先进入冷静期，冷静期内你可以撤销；之后由人工审核。大额提现在审核通过后还会延迟一段时间再发出，延迟期内可以紧急取消。',
        '提现手续费从提现金额中扣除，具体金额在提现页面显示。',
        '提现一经发到区块链上就无法撤回，请确认地址和网络正确。',
        '为保护账户安全或配合依法提出的要求，我们可能暂缓或拒绝某笔提现，并尽可能告诉你原因。',
      ],
    },
    {
      h: '7. 交易',
      p: [
        '报价由本服务提供，包括卖价和买价，两者之差是点差。买入按买价成交，卖出按卖价成交。',
        '每笔持仓使用逐仓保证金。下单前，客户端会显示所需保证金、手续费和预估强平价。',
        '当一笔持仓的保证金比例跌到维持保证金水平时，系统会自动强制平仓（强平）。保证金比例接近追保线时我们会尽量提醒你，但提醒不是强平的前提。',
        '止盈、止损和限价挂单在报价达到触发价格时执行。行情跳空或剧烈波动时，成交价可能和你设定的价格不同。',
        '各品种只在交易时段内可以交易，休市时不能开仓或平仓。报价异常或中断时，相关品种可能暂停交易。为控制风险，我们也可能暂停某个品种或全部品种的开仓。',
        '如果因为明显的系统错误或报价错误产生了成交，我们保留更正或撤销该成交的权利，并会通知你。',
      ],
    },
    {
      h: '8. 费用',
      p: [
        '本服务的费用包括开仓手续费、隔夜费（持仓过夜时按品种设定收取或返还）和提现手续费；点差体现在买卖价之间。',
        '具体费率在客户端的品种信息、下单页面和提现页面显示。费率调整会在客户端公布。',
      ],
    },
    {
      h: '9. 禁止行为',
      p: [
        '你不得：利用系统错误、报价延迟或报价错误牟利；用自动化工具干扰或攻击本服务；冒用他人的身份或资料；进行洗钱、恐怖融资或其他违法活动；以任何方式妨碍其他用户正常使用本服务。',
        '发现上述行为时，我们可以限制或冻结账户、撤销相关交易，并依法向有关部门报告。',
      ],
    },
    {
      h: '10. 账户冻结和终止',
      p: [
        '你可以随时停止使用本服务，并在没有持仓和挂单后申请注销账户。',
        '你违反本条款、涉嫌违法，或我们依法被要求时，我们可以冻结或关闭你的账户。除依法需要扣留的情况外，账户余额会在核实后按提现规则退还给你。',
      ],
    },
    {
      h: '11. 服务可用性',
      p: [
        '我们会尽力保持本服务稳定，但不保证服务不中断、不出错。系统维护、网络故障、区块链拥堵和第三方服务故障都可能影响充值、提现和交易。',
        '我们可能更新、调整或停止部分功能，重要变化会提前在客户端公布。',
      ],
    },
    {
      h: '12. 责任限制',
      p: [
        '在法律允许的范围内，我们不对以下损失负责：市场波动造成的交易亏损；你没有妥善保管账户信息造成的损失；你填错地址或选错网络造成的损失；不可抗力、区块链网络或第三方服务故障造成的损失。',
        '本条款不排除、不限制依法不能排除或限制的责任。',
      ],
    },
    {
      h: '13. 条款变更',
      p: [
        '我们可能修改本条款。修改后的条款会在本页面公布并注明更新日期；重要修改会通过站内信或邮件通知你。修改生效后你继续使用本服务，即视为接受修改后的条款。',
      ],
    },
    {
      h: '14. 联系我们',
      p: ['对本条款有任何问题，请发邮件到 info@quickcome.online。'],
    },
  ],
};

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  intro: [
    'These Terms of Service ("Terms") apply to your use of the Quick Come website, client application and related services (together, the "Service"). By creating an account or using the Service you confirm that you have read, understood and agreed to these Terms. If you do not agree, do not sign up for or use the Service.',
    'Operating entity, place of registration, governing law and dispute resolution: to be provided.',
  ],
  sections: [
    {
      h: '1. The Service',
      p: [
        'The Service is a contracts for difference (CFD) trading platform that uses USDT as margin and settlement currency. Through the Service you can deposit USDT, trade CFDs on forex, metals, indices, energy, crypto and other instruments, and withdraw your account balance as USDT.',
        'CFDs do not give you ownership of any underlying asset and never involve physical delivery.',
        'The Service does not provide investment advice, asset management or trading on your behalf. Nothing on the website or in the client is a recommendation to make any trade.',
      ],
    },
    {
      h: '2. Eligibility',
      p: [
        'You must be at least 18 years old (or the age of majority where you live, whichever is higher) and have full legal capacity.',
        'You are responsible for making sure that using the Service is lawful where you live. Do not use the Service where CFD trading or the Service itself is prohibited.',
        'Each person may hold only one account. Your account is for your own use only and may not be lent, transferred or sold.',
      ],
    },
    {
      h: '3. Account and security',
      p: [
        'To sign up you receive a verification code by email and set a password that meets our requirements. The information you provide must be true, accurate and complete, and you must keep it up to date.',
        'Keep your password and email account safe. Anything done through your account is treated as done by you. If you notice anything unusual, change your password immediately and contact us.',
        'Your account is locked for a while after too many wrong password attempts.',
      ],
    },
    {
      h: '4. Identity verification (KYC)',
      p: [
        'You must complete identity verification before you can withdraw: submit your identity document details and photos, which are reviewed by a person. Signing up, depositing and trading do not require verification first.',
        'During review we may ask for more information. If the information is untrue, incomplete or does not match your account, we may reject the verification and tell you why.',
        'How we handle verification data is described in the Privacy Policy.',
      ],
    },
    {
      h: '5. Deposits',
      p: [
        'The Service accepts USDT only, on three networks: ERC20 (Ethereum), TRC20 (TRON) and BSC (BEP20). Every account has its own deposit address.',
        'The minimum deposit is 1 USDT. Transfers below the minimum are not credited.',
        'Always check the network and the token. Funds sent on the wrong network, tokens other than USDT, or funds sent to a wrong address may be lost; we have no obligation and may have no ability to recover them.',
        'Deposits are credited automatically once they reach the required number of blockchain confirmations. If an on-chain transaction is reversed or found invalid, we will reverse the corresponding credit.',
      ],
    },
    {
      h: '6. Withdrawals',
      p: [
        'To withdraw, all of the following must be true: your identity verification is approved; the destination address is on your withdrawal whitelist and, if newly added, its 24-hour waiting period has passed; and the amount is within the per-withdrawal and daily limits shown on the withdrawal page.',
        'A submitted withdrawal first enters a cooling-off period during which you can cancel it, and is then reviewed by a person. Large withdrawals are held for an additional period after approval, during which they can still be cancelled.',
        'The withdrawal fee is deducted from the amount withdrawn; the exact fee is shown on the withdrawal page.',
        'Once a withdrawal has been sent to the blockchain it cannot be reversed. Make sure the address and network are correct.',
        'To protect your account or to comply with lawful requests, we may delay or refuse a withdrawal and will tell you the reason where we can.',
      ],
    },
    {
      h: '7. Trading',
      p: [
        'Prices are quoted by the Service as a sell (bid) price and a buy (ask) price; the difference between them is the spread. Buy orders fill at the buy price and sell orders at the sell price.',
        'Each position uses isolated margin. Before you place an order, the client shows the required margin, the fee and the estimated liquidation price.',
        'When the margin level of a position falls to the maintenance margin, the system closes it automatically (liquidation). We try to alert you when the margin level approaches the margin call line, but an alert is not a precondition for liquidation.',
        'Take profit, stop loss and limit orders are executed when the price reaches the trigger price. In gapping or fast markets the fill price may differ from the price you set.',
        'Each instrument can be traded only during its trading sessions; you cannot open or close positions while a market is closed. Trading in an instrument may be suspended if its prices are abnormal or interrupted, and we may suspend opening new positions in one or all instruments to manage risk.',
        'If a trade results from an obvious system or pricing error, we reserve the right to correct or cancel it and will notify you.',
      ],
    },
    {
      h: '8. Fees',
      p: [
        'Fees consist of an opening fee, overnight financing (charged or credited per instrument when a position is held overnight) and withdrawal fees; the spread is reflected in the difference between buy and sell prices.',
        'Exact rates are shown in the instrument details, on the order page and on the withdrawal page in the client. Rate changes are announced in the client.',
      ],
    },
    {
      h: '9. Prohibited conduct',
      p: [
        'You must not: profit from system errors or delayed or erroneous prices; use automated tools to disrupt or attack the Service; use another person\'s identity or information; engage in money laundering, terrorist financing or any other unlawful activity; or interfere in any way with other users\' use of the Service.',
        'If we find such conduct we may restrict or freeze the account, cancel the related trades and report it to the authorities as required by law.',
      ],
    },
    {
      h: '10. Suspension and termination',
      p: [
        'You may stop using the Service at any time and ask to close your account once you have no open positions or pending orders.',
        'If you breach these Terms, are suspected of unlawful activity, or we are required by law, we may freeze or close your account. Unless funds must be withheld by law, your balance will be returned to you under the withdrawal rules after verification.',
      ],
    },
    {
      h: '11. Availability of the Service',
      p: [
        'We work to keep the Service stable but do not guarantee that it will be uninterrupted or error-free. Maintenance, network failures, blockchain congestion and failures of third-party services can all affect deposits, withdrawals and trading.',
        'We may update, change or discontinue some features; significant changes will be announced in the client in advance.',
      ],
    },
    {
      h: '12. Limitation of liability',
      p: [
        'To the extent permitted by law, we are not liable for: trading losses caused by market movements; losses caused by your failure to keep your account details safe; losses caused by a wrong address or network you entered; or losses caused by force majeure, blockchain networks or failures of third-party services.',
        'Nothing in these Terms excludes or limits any liability that cannot be excluded or limited by law.',
      ],
    },
    {
      h: '13. Changes to these Terms',
      p: [
        'We may change these Terms. The updated Terms will be posted on this page with a new date, and we will tell you about significant changes by in-app message or email. If you keep using the Service after the changes take effect, you accept the updated Terms.',
      ],
    },
    {
      h: '14. Contact us',
      p: ['If you have any questions about these Terms, email us at info@quickcome.online.'],
    },
  ],
};

const privacyZh: LegalDoc = {
  title: '隐私政策',
  intro: [
    '本隐私政策说明 Quick Come（以下简称"我们"）在你使用网站、客户端和相关服务时，收集哪些个人信息、为什么收集、怎样使用和保护，以及你享有的权利。',
    '个人信息的处理者（运营主体）、联系地址和信息存放地点：待提供。',
  ],
  sections: [
    {
      h: '1. 我们收集的信息',
      p: [
        '注册和账户信息：邮箱、密码（只保存经过不可逆处理的结果，不保存明文）、姓名、出生日期、国籍，以及界面语言等偏好设置。',
        '身份认证信息：证件类型、证件号码、证件照片和手持证件的照片。',
        '资金和交易信息：充值地址、提现白名单地址、充值和提现记录、订单、持仓和资金流水。',
        '设备和使用信息：登录时间、登录 IP 地址、浏览器信息；如果你开启了浏览器推送，还包括浏览器提供的推送订阅信息。',
        '你主动联系我们时提供的信息，例如邮件内容。',
      ],
    },
    {
      h: '2. 我们怎样使用这些信息',
      p: [
        '提供和维护服务：注册登录、充值入账、处理订单和持仓、处理提现。',
        '身份核验和账户安全：审核身份认证、识别异常登录和可疑操作、防范欺诈和洗钱。',
        '通知你：通过站内信、邮件和浏览器推送发送验证码、到账、成交、追保、强平、审核结果等通知。你可以在客户端调整推送和通知设置（验证码等必要通知除外）。',
        '履行法律义务，配合有权机关依法提出的要求。',
        '我们不出售你的个人信息，也不把它用于广告投放。',
      ],
    },
    {
      h: '3. Cookie 和本地存储',
      p: [
        '官网不使用 Cookie。客户端只用一个登录 Cookie（设置为 HttpOnly，网页脚本读不到）来保持你的登录状态。',
        '语言、主题、自选品种等偏好设置保存在你的浏览器本地，不会发送给第三方。',
        '我们的网站和客户端不使用任何第三方统计、广告或追踪代码，也不加载 Google 等第三方的字体和脚本。',
      ],
    },
    {
      h: '4. 信息共享',
      p: [
        '我们只在以下情况向第三方提供你的个人信息，并且只提供必要的部分：为我们提供邮件发送、数据存储、服务器托管等服务的服务商，他们只能按我们的要求处理信息；浏览器推送服务（由你的浏览器厂商提供），只用于把通知送到你的设备，推送内容经过加密；法律法规要求或有权机关依法要求时。',
        '区块链上的充值和提现交易是公开的，任何人都能在区块链上看到地址和金额，这不由我们控制。',
      ],
    },
    {
      h: '5. 存储和保护',
      p: [
        '证件照片存放在对象存储里，数据库只保存文件路径；密码只保存经过不可逆处理的结果。',
        '我们限制内部人员访问个人信息：只有工作需要的管理员按权限才能查看，后台操作有审计记录。',
        '网页和接口都通过 HTTPS 加密传输。',
        '没有任何系统能保证绝对安全。如果发生个人信息安全事件，我们会按法律要求通知你。',
      ],
    },
    {
      h: '6. 保存期限',
      p: ['账户存续期间我们保存你的信息。注销账户后，我们会在法律要求的保存期限届满后删除或匿名化处理你的信息；具体期限：待法务确定。'],
    },
    {
      h: '7. 你的权利',
      p: [
        '你可以在客户端查看你的个人资料，修改密码、语言和通知设置。',
        '你可以发邮件到 info@quickcome.online，要求查阅、更正、删除你的个人信息或注销账户。我们会在核实身份后处理；依法需要保留的信息除外。',
      ],
    },
    {
      h: '8. 未成年人',
      p: ['本服务不面向未满 18 周岁的人。如果发现收集了未成年人的信息，我们会尽快删除。'],
    },
    {
      h: '9. 政策更新',
      p: ['我们可能更新本政策。更新后的政策会在本页面公布并注明更新日期；重要变化会通过站内信或邮件通知你。'],
    },
    {
      h: '10. 联系我们',
      p: ['对本政策或你的个人信息有任何问题，请发邮件到 info@quickcome.online。'],
    },
  ],
};

const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  intro: [
    'This Privacy Policy explains what personal information Quick Come ("we") collects when you use our website, client application and related services, why we collect it, how we use and protect it, and what rights you have.',
    'Data controller (operating entity), contact address and where the data is stored: to be provided.',
  ],
  sections: [
    {
      h: '1. Information we collect',
      p: [
        'Sign-up and account information: email address, password (we store only an irreversible hash, never the plain text), name, date of birth, nationality, and preferences such as interface language.',
        'Identity verification information: document type, document number, photos of the document and a photo of you holding it.',
        'Funds and trading information: deposit addresses, withdrawal whitelist addresses, deposit and withdrawal records, orders, positions and account statements.',
        'Device and usage information: login times, login IP addresses and browser information; if you turn on browser notifications, the push subscription provided by your browser.',
        'Information you give us when you contact us, such as the content of your emails.',
      ],
    },
    {
      h: '2. How we use it',
      p: [
        'To provide and maintain the Service: sign-up and login, crediting deposits, handling orders and positions, and processing withdrawals.',
        'For identity checks and account security: reviewing identity verification, detecting unusual logins and suspicious activity, and preventing fraud and money laundering.',
        'To notify you: we send verification codes and notices about deposits, fills, margin calls, liquidations and review results by in-app message, email and browser notification. You can adjust notification settings in the client (except necessary messages such as verification codes).',
        'To meet legal obligations and respond to lawful requests from competent authorities.',
        'We do not sell your personal information and do not use it for advertising.',
      ],
    },
    {
      h: '3. Cookies and local storage',
      p: [
        'The website does not use cookies. The client uses a single login cookie (HttpOnly, so scripts on the page cannot read it) to keep you signed in.',
        'Preferences such as language, theme and watchlist are stored locally in your browser and are not sent to third parties.',
        'Our website and client do not use any third-party analytics, advertising or tracking code and do not load fonts or scripts from Google or other third parties.',
      ],
    },
    {
      h: '4. Sharing',
      p: [
        'We share your personal information with third parties only in the following cases, and only what is necessary: service providers that send email, store data or host servers for us, who may process it only on our instructions; browser push services (run by your browser vendor), used only to deliver notifications to your device, with the content encrypted; and when required by law or by a lawful request from a competent authority.',
        'Deposit and withdrawal transactions on a blockchain are public: anyone can see the addresses and amounts on the chain. This is outside our control.',
      ],
    },
    {
      h: '5. Storage and protection',
      p: [
        'Document photos are kept in object storage and the database stores only the file path; passwords are stored only as irreversible hashes.',
        'Internal access is restricted: only administrators who need it for their work can view personal information, according to their permissions, and admin actions are recorded in an audit log.',
        'All web pages and interfaces are served over HTTPS.',
        'No system is perfectly secure. If a personal data breach occurs, we will notify you as required by law.',
      ],
    },
    {
      h: '6. Retention',
      p: ['We keep your information while your account exists. After you close your account, we delete or anonymise your information once the retention period required by law has passed; the exact period is to be determined by legal counsel.'],
    },
    {
      h: '7. Your rights',
      p: [
        'In the client you can view your profile and change your password, language and notification settings.',
        'You can email info@quickcome.online to ask to access, correct or delete your personal information or to close your account. We will act on your request after verifying your identity, except for information we must keep by law.',
      ],
    },
    {
      h: '8. Minors',
      p: ['The Service is not intended for anyone under 18. If we find that we have collected information about a minor, we will delete it as soon as possible.'],
    },
    {
      h: '9. Changes to this policy',
      p: ['We may update this policy. The updated policy will be posted on this page with a new date, and we will tell you about significant changes by in-app message or email.'],
    },
    {
      h: '10. Contact us',
      p: ['If you have any questions about this policy or your personal information, email us at info@quickcome.online.'],
    },
  ],
};

const riskZh: LegalDoc = {
  title: '风险披露',
  intro: [
    '本风险披露说明通过 Quick Come 交易差价合约（CFD）的主要风险，但不能列出全部风险。开始交易前请仔细阅读，确认你了解差价合约的运作方式，并能承受可能的损失；如有疑问，请咨询独立的专业顾问。',
  ],
  sections: [
    {
      h: '1. 差价合约是复杂产品',
      p: [
        '差价合约按标的价格的涨跌结算盈亏，你不持有任何标的资产。你可以买涨，也可以卖跌，但判断错误就会亏损。',
        '成交价格以本平台的报价为准，可能和其他平台或标的市场的价格不同。',
      ],
    },
    {
      h: '2. 杠杆会放大亏损',
      p: [
        '使用杠杆时，你只需要投入名义价值的一小部分作为保证金，价格小幅变动就可能造成相对于保证金很大的盈亏。例如按 100 倍杠杆开仓时，价格反向变动 1%，亏损就相当于全部保证金。',
        '请控制每笔交易的手数和总持仓，不要把全部资金押在一笔交易上。',
      ],
    },
    {
      h: '3. 强制平仓',
      p: [
        '每笔持仓使用逐仓保证金。持仓亏损使保证金比例跌到维持保证金水平时，系统会自动按当时的价格平仓。',
        '强平的成交价可能比预估强平价更差，在行情快速变化或跳空时尤其如此；你可能损失这笔持仓的全部保证金。',
        '追保提醒只是尽力发出的通知，可能因为网络、设备或通知渠道的原因延迟或收不到。你有责任自己关注持仓。',
      ],
    },
    {
      h: '4. 市场波动和跳空',
      p: [
        '价格可能在短时间内大幅变动。重大新闻、经济数据公布、节假日和周末前后，价格可能跳空，也就是前后两个价格之间没有连续成交。',
        '止损单不能保证按你设定的价格成交：跳空时会按触发后第一个可用的价格成交，亏损可能大于预期。',
      ],
    },
    {
      h: '5. 交易时段和休市',
      p: ['每个品种有自己的交易时段和假日安排。休市期间不能开仓、平仓或修改订单，但持仓仍然承担休市期间价格变化的风险。'],
    },
    {
      h: '6. 报价、点差和费用',
      p: [
        '买价和卖价之间有点差，开仓时你就处于小幅亏损状态。',
        '开仓手续费和隔夜费会减少收益或增加亏损；隔夜费可能是收取，也可能是返还。',
        '报价可能因为报价源异常、网络中断等原因暂停或延迟，此时相关品种可能无法交易。',
      ],
    },
    {
      h: '7. USDT 和区块链风险',
      p: [
        '你的保证金和盈亏以 USDT 计价。USDT 由第三方发行，它的价值可能偏离 1 美元，也可能受到发行方、监管或市场事件的影响。',
        '区块链转账一经确认就无法撤回。转错地址、选错网络或转入其他代币，资金可能永久丢失。',
        '区块链拥堵、分叉或节点故障可能导致充值和提现延迟。',
      ],
    },
    {
      h: '8. 加密货币品种的额外风险',
      p: ['加密货币的价格波动通常远大于外汇和贵金属，可能在几分钟内大幅涨跌。加密货币品种全天交易，夜间和周末同样可能发生强平。'],
    },
    {
      h: '9. 技术风险',
      p: ['交易依赖互联网、你的设备和我们的系统。网络中断、设备或浏览器故障、系统故障或维护，都可能导致你无法及时下单、平仓或看到最新价格。'],
    },
    {
      h: '10. 不构成投资建议',
      p: [
        '网站、客户端、通知和其他资料中的信息只用于说明，不构成投资建议，也不是对收益的承诺。过去的价格表现不代表未来。',
        '只用你能承受全部损失的资金交易，不要借钱交易。',
      ],
    },
    {
      h: '11. 法律和监管',
      p: ['差价合约在部分国家或地区受到限制或被禁止，你有责任确认在你所在地使用本服务是合法的。监管与牌照信息：待提供。'],
    },
  ],
};

const riskEn: LegalDoc = {
  title: 'Risk Disclosure',
  intro: [
    'This Risk Disclosure describes the main risks of trading contracts for difference (CFDs) on Quick Come, but it cannot list every risk. Read it carefully before you start trading and make sure you understand how CFDs work and can afford the possible losses. If in doubt, consult an independent professional adviser.',
  ],
  sections: [
    {
      h: '1. CFDs are complex products',
      p: [
        'A CFD settles profit and loss on changes in the price of the underlying; you do not own any underlying asset. You can buy (go long) or sell (go short), and you lose money if the market moves against you.',
        'Trades are filled at the prices quoted by this platform, which may differ from prices on other platforms or in the underlying market.',
      ],
    },
    {
      h: '2. Leverage magnifies losses',
      p: [
        'With leverage you put up only a small part of the notional value as margin, so a small price move can cause a large profit or loss relative to that margin. For example, at 100:1 leverage a 1% adverse move equals a loss of the entire margin.',
        'Keep the size of each trade and your total exposure under control; do not commit all of your funds to a single trade.',
      ],
    },
    {
      h: '3. Liquidation',
      p: [
        'Each position uses isolated margin. When losses bring the margin level of a position down to the maintenance margin, the system closes it automatically at the prevailing price.',
        'The liquidation price can be worse than the estimated liquidation price, especially in fast or gapping markets, and you may lose all of the margin of that position.',
        'Margin call alerts are sent on a best-effort basis and may be delayed or not received because of network, device or notification channel issues. You are responsible for monitoring your positions.',
      ],
    },
    {
      h: '4. Volatility and gaps',
      p: [
        'Prices can move sharply in a short time. Around major news, economic data releases, holidays and weekends, prices may gap, meaning there is no continuous trading between one price and the next.',
        'A stop loss does not guarantee the price you set: in a gap it is filled at the first available price after it is triggered, and the loss may be larger than expected.',
      ],
    },
    {
      h: '5. Trading sessions and closed markets',
      p: ['Each instrument has its own trading sessions and holidays. While a market is closed you cannot open, close or modify positions, but your positions are still exposed to price changes over that period.'],
    },
    {
      h: '6. Prices, spreads and costs',
      p: [
        'There is a spread between the buy and sell prices, so a new position starts with a small loss.',
        'Opening fees and overnight financing reduce your profit or add to your loss; overnight financing may be charged or credited.',
        'Prices may be suspended or delayed because of feed problems or network outages, and the affected instruments may then be untradeable.',
      ],
    },
    {
      h: '7. USDT and blockchain risks',
      p: [
        'Your margin and profit and loss are denominated in USDT. USDT is issued by a third party; its value may deviate from 1 US dollar and may be affected by events involving the issuer, regulators or the market.',
        'Blockchain transfers cannot be reversed once confirmed. Funds sent to a wrong address, on the wrong network or as another token may be lost permanently.',
        'Blockchain congestion, forks or node failures can delay deposits and withdrawals.',
      ],
    },
    {
      h: '8. Additional risks of crypto instruments',
      p: ['Crypto prices are usually far more volatile than forex or metals and can rise or fall sharply within minutes. Crypto instruments trade around the clock, so liquidations can also happen at night and at weekends.'],
    },
    {
      h: '9. Technical risks',
      p: ['Trading depends on the internet, your device and our systems. Network outages, device or browser problems, system failures or maintenance can prevent you from placing or closing orders or seeing the latest prices in time.'],
    },
    {
      h: '10. No investment advice',
      p: [
        'Information on the website, in the client, in notifications and in any other material is for explanation only. It is not investment advice or a promise of returns. Past price performance is not a guide to the future.',
        'Only trade with money you can afford to lose entirely, and never trade with borrowed money.',
      ],
    },
    {
      h: '11. Legal and regulatory',
      p: ['CFDs are restricted or prohibited in some countries and regions. You are responsible for making sure that using the Service is lawful where you live. Regulatory and licence information: to be provided.'],
    },
  ],
};

export const LEGAL: Record<LegalPage, Record<Lang, LegalDoc>> = {
  terms: { 'zh-CN': termsZh, en: termsEn },
  privacy: { 'zh-CN': privacyZh, en: privacyEn },
  risk: { 'zh-CN': riskZh, en: riskEn },
};
