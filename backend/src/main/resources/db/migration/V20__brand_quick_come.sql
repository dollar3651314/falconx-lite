-- V20（v2 品牌改名）：内置通知模板里的旧品牌名改成 Quick Come。说明见 需求文档/v2-需求说明书.md 第 4.5、8 节。
-- 只改"仍然完全等于原始默认文字"的模板：标题和正文（中英文共 4 段）都和 V14 写入的一字不差才改，
-- 运营在后台改过其中任何一段的模板保留原样（后台通知模板页会提醒运营检查文案里还有旧品牌名的模板）。
-- 比较用 utf8mb4_bin（区分大小写、逐字节），表的默认排序规则不区分大小写，运营只改了大小写也算改过。
-- 已经发出的邮件、推送、站内信记录不改（历史记录保持原样）。
-- V14 里只有 EMAIL_CODE（邮箱验证码）的标题带旧品牌名，其他模板没有。

UPDATE notify_template
SET title_zh = 'Quick Come 验证码',
    title_en = 'Quick Come verification code'
WHERE code = 'EMAIL_CODE'
  AND title_zh COLLATE utf8mb4_bin = 'FalconX 验证码'
  AND title_en COLLATE utf8mb4_bin = 'FalconX verification code'
  AND body_zh COLLATE utf8mb4_bin = '您的验证码是 {code}，10 分钟内有效。请勿告诉任何人。'
  AND body_en COLLATE utf8mb4_bin = 'Your code is {code}. It expires in 10 minutes. Do not share it with anyone.';
