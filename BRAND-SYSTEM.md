# m7md-d — Brand System

> مرجع الهوية الشخصية والتقنية لمحمد سعيد الدوسري / `m7md-d`.
>
> هذا الملف يعرّف **كيف تفكر الهوية، كيف تتكلم، وكيف يمكن أن تظهر**. ليس قالب واجهة إلزاميًا، ولا يعني أن كل مشروع يجب أن يبدو كطرفية أو ملف ELF.

---

## 0. الفكرة قبل الشكل

البراند ليس skin يوضع فوق المنتج.

البراند هو مجموعة قرارات ثابتة نسبيًا تظهر في:

- طريقة تنظيم المعلومات.
- الدقة في وصف الواقع وحدود المعرفة.
- الميل إلى فهم ما تحت الـ abstraction بدل الاكتفاء بسطحه.
- تحويل المشاكل إلى نماذج وحالات وأدلة قابلة للفحص.
- بناء أدوات تحل مشكلة فعلية بدل بناء استعراض تقني بلا داعٍ.
- ترك التفاصيل التقنية الصغيرة لمن يريد اكتشافها، دون إجبار كل مستخدم على فهمها.

أما الطرفية، والهيكسا، وASCII، وأسماء المقاطع، والنوافذ الشبيهة بالنظام فهي **مفردات تعبير** يمكن استخدامها عندما تناسب المنتج. ليست البراند نفسه.

### القاعدة الأهم

> إذا أزلنا كل الزخارف، يجب أن تبقى الشخصية واضحة من طريقة المنتج في العمل والشرح واتخاذ القرار.

---

# 1. هوية البراند

## 1.1 الاسمان

المواد الحالية تستخدم مستويين للاسم، ويعامل هذا المرجع الاثنين بوصفهما متكاملين:

- **Mohammed Saeed Al-Dosari / محمد سعيد الدوسري**: الهوية البشرية والرسمية، مناسبة للموقع الشخصي، السيرة، التواصل، وصف المالك، والواجهات التي تحتاج شخصًا واضحًا خلف المنتج.
- **`m7md-d`**: التوقيع التقني العام، مناسب لـ GitHub، الآثار التقنية، الأدوات، التلميحات، والواجهات التي تستفيد من هوية مختصرة وقابلة للترميز.

لا يلزم وضع الاسمين معًا في كل مكان.

## 1.2 الوصف المختصر المعتمد

```text
Exploring low-level systems & security.
```

هذا وصف هوية، وليس title وظيفيًا ولا ادعاء تخصص مغلق.

عند الحاجة إلى وصف أوسع:

```text
Systems, security, reverse engineering and tools for real problems.
```

## 1.3 مركز الاهتمام

المركز ليس «الأمن السيبراني» وحده، وليس «البرمجة» وحدها.

المركز هو:

**فهم الأنظمة + بناء الأدوات + النزول تحت التجريد عندما يصبح ذلك مفيدًا.**

ويظهر ذلك طبيعيًا في:

- low-level systems
- reverse engineering
- security
- operating systems
- runtime behavior
- file formats and binaries
- developer tooling
- automation
- experiments and technical reconstruction

## 1.4 العبارة التي تلخص طريقة التفكير

الموقع الحالي يحتوي عبارة مناسبة جدًا كمرجع داخلي:

```text
Understand the abstraction. Then look beneath it.
```

لا يجب تحويلها إلى slogan يكرر في كل منتج. قيمتها أنها تصف **طريقة النظر**:

1. افهم السطح الذي يتعامل معه المستخدم.
2. حدد ما يخفيه هذا السطح.
3. انزل طبقة عندما تكون الطبقة الأدنى مؤثرة في القرار.
4. ارجع بدليل أو نموذج أو قياس، لا بمجرد انطباع.

---

# 2. شخصية البراند

يمكن اختصار الشخصية في ستة محاور.

## 2.1 Technical, not theatrical

تقني فعلًا، لا «مظهر هاكر».

الهيكسا أو الطرفية تستخدم لأن لها معنى أو لأنها امتداد طبيعي للمحتوى، لا لأنها تبدو cyberpunk.

## 2.2 Precise, not sterile

الدقة أساسية، لكن المنتج لا يحتاج أن يكون بلا شخصية.

يمكن أن توجد لمسة ساخرة أو غريبة أو تلميح صغير، بشرط ألا تفسد وضوح الحالة أو المعلومة.

## 2.3 Curious, not performative

الفضول يظهر في الأسئلة والتجارب والآثار التي تم الوصول إليها، لا في عبارات تسويقية من نوع “passionate about technology”.

## 2.4 Dense when useful, quiet when not

يمكن أن تكون الواجهة كثيفة بالمعلومات عندما تخدم تشخيصًا أو مراقبة أو تحليلًا.

ويمكن أن تكون شديدة البساطة عندما تكون المهمة مباشرة.

الهوية لا تتطلب ملء الفراغ ببيانات وهمية.

## 2.5 Evidence over self-description

بدل:

```text
Expert in low-level programming
```

يفضل إظهار مشروع، تحليل، مساهمة، نتيجة اختبار، أو قرار هندسي يثبت ذلك.

## 2.6 Controlled weirdness

هناك مساحة للغرابة المحسوبة:

- تسمية ملف أو مسار داخلي بطريقة ذكية.
- رسالة MOTD.
- byte sequence لها معنى.
- خلفية أو ASCII signature.
- تقرير عسكري ساخر في مشروع مثل COMMANDER.

لكن الغرابة لا تتحول إلى ضجيج عام يطغى على الوظيفة.

---

# 3. ما هو ثابت وما هو اختياري

هذا أهم جزء عند تطبيق الهوية على أدوات مختلفة.

## 3.1 Core — ثابت دائمًا

هذه مبادئ البراند حتى في برنامج بلا أي بصريات خاصة:

- الصدق في عرض الحالة والبيانات.
- عدم اختراع قيم لملء الفراغ.
- التفريق بين observed وinferred وunknown.
- وصف المشكلة قبل استعراض التقنية.
- تنظيم واضح للحالة والمخرجات.
- نص مباشر ومقتصد.
- إظهار الحدود والقيود عندما تؤثر في القرار.
- جعل الطبقات الداخلية قابلة للفحص عند الحاجة.
- عدم إجبار المستخدم على gimmick للوصول إلى الوظيفة.

## 3.2 Structural DNA — مفضل عند ملاءمته

يمكن أن يظهر بدون تحويل المنتج إلى «ثيم طرفية»:

- ألوان محايدة داكنة.
- typography هندسي واضح.
- monospace للبيانات التقنية.
- خطوط وحدود مستقيمة.
- labels قصيرة ومنظمة.
- حالة النظام ظاهرة بوضوح.
- timestamps / paths / IDs / offsets عندما تكون بيانات حقيقية.
- hierarchy يشبه أدوات الأنظمة أكثر من landing pages التسويقية.

## 3.3 Machine language — اختياري

مفردات ترفع حضور الهوية عندما تناسب السياق:

- `.text`, `.rodata`, `.data`, `.build`
- `r-x`, `r--`, `rw-`
- offsets مثل `0x0100`
- byte sequences
- ELF magic أو file signatures
- shell prompt
- paths
- process/session concepts
- `ENODATA`, exit status, error codes
- ASCII art
- binary or memory-map metaphors

## 3.4 Immersive layer — اختياري جدًا

يستخدم فقط عندما المنتج يتحمل تجربة كاملة:

- desktop/workspace metaphor
- windows and taskbar
- terminal navigation
- virtual filesystem
- process monitor
- system session
- interactive ASCII scene
- simulated runtime state

هذا مناسب للبورتفوليو، تجربة فنية تقنية، demo، أو منتج يبرر الفكرة.

ليس مناسبًا تلقائيًا لأداة صغيرة أو utility تحتاج أن تنجز المهمة بسرعة.

---

# 4. مستويات شدة الهوية

قبل تصميم أي منتج، اختر المستوى بدل خلط كل شيء معًا.

| المستوى | الاستخدام | ما يظهر |
| --- | --- | --- |
| **L0 — Invisible Brand** | مكتبة، CLI بسيط، backend، أداة داخلية | الدقة، أسلوب النص، الحالات، الأخطاء، التوثيق |
| **L1 — Structural** | GUI utility، dashboard، desktop tool | اللوحة المحايدة، mono للبيانات، grid، status language |
| **L2 — Technical Signature** | أدوات أنظمة، RE، DFIR، diagnostics | hints من paths/bytes/sections/offsets بحسب السياق |
| **L3 — Immersive** | portfolio، showcase، interactive experiment | workspace/terminal/ASCII/process/session metaphors |

### قاعدة الاختيار

لا تستخدم مستوى أعلى لمجرد أنك تستطيع.

استخدم **أقل مستوى يحقق الشخصية ويخدم المنتج**.

---

# 5. الفلسفة البصرية

## 5.1 الانطباع

المطلوب ليس «غرفة هاكر».

المطلوب أقرب إلى:

**آلة منظمة، هادئة، يمكن فحصها.**

الحضور يأتي من:

- alignment
- rhythm
- hierarchy
- real data
- controlled density
- restrained contrast
- technical semantics

وليس من:

- neon green
- purple cyberpunk
- glow everywhere
- smoke
- Matrix rain كحل افتراضي
- hex random noise
- skulls / hoodies / hacker stock imagery

## 5.2 لوحة الألوان الأساسية

| الاستخدام | اللون |
| --- | --- |
| Background | `#090B0D` |
| Surface / panel | `#111519` |
| Border / separator | `#30373E` |
| Primary text | `#E1E5E8` |
| Secondary text | `#C0C8CF` |
| Muted / metadata | `#909AA3` |

هذه اللوحة هي المرجع الأساسي، وليست قيدًا يمنع كل لون آخر.

### اللون الوظيفي

يجوز إدخال ألوان للحالات مثل success/warning/error أو visualization عندما تكون وظيفية.

القواعد:

1. اللون له وظيفة، لا هوية بديلة.
2. لا يتحول accent إلى لون يهيمن على التطبيق كله بلا سبب.
3. الحالة لا تعتمد على اللون وحده.
4. مشروع له مجال بصري خاص يمكن أن يضيف لونه مع بقاء البنية العامة منضبطة.

## 5.3 Typography

القاعدة العامة:

- **Monospace** للبيانات، المسارات، الأكواد، labels التقنية، السجلات، metadata.
- **Sans** للنصوص الطويلة عندما تصبح القراءة أهم من الإحساس بالطرفية.
- العربية لا تُجبر داخل mono إن كان ذلك يضعف القراءة.

الاختيارات الموجودة في الموقع الحالي تعطي اتجاهًا جيدًا:

- JetBrains Mono
- Space Grotesk
- IBM Plex Sans Arabic

هذه implementation choices وليست أصولًا مقدسة للهوية.

## 5.4 Geometry

يفضل:

- زوايا مستقيمة أو radius قليل.
- borders واضحة وخفيفة.
- grid منظم.
- مسافات محسوبة.
- panels ذات سبب وظيفي.

تجنب تحويل «الحدة» إلى أشكال زخرفية حادة بلا معنى. الحدة هنا تأتي أساسًا من **لغة النظام وتنظيم المعلومات**.

## 5.5 الحركة

الحركة ليست عنصرًا أساسيًا في البراند.

إن وجدت:

- قصيرة.
- هادئة.
- مرتبطة بحالة أو انتقال.
- لا تؤخر القراءة.
- لا تجعل المستخدم ينتظر typing animation مصطنعة.
- تحترم `prefers-reduced-motion`.

---

# 6. التلميحات وEaster Eggs

## 6.1 القاعدة

> التلميح يجب أن يحمل معنى حقيقيًا، ثم يترك للمستخدم حرية اكتشافه.

التلميح الجيد يعمل على مستويين:

1. يبدو طبيعيًا داخل الواجهة حتى لو لم يفهمه المستخدم.
2. يكافئ المستخدم الذي يعرف المرجع أو يقرر فحصه.

## 6.2 لا تشرح التلميح بجانبه

مثال معتمد:

```text
6d 37 6d 64 2d 64
```

وهو ASCII لـ `m7md-d`.

لا يوضع بجانبه:

```text
|m7md-d|
```

لأن ذلك يحول الاكتشاف إلى caption.

إذا احتاج المعنى توثيقًا، يوثق في:

- ملف الهوية.
- developer notes.
- source comment عند الحاجة.
- صفحة reference منفصلة إن كان المشروع نفسه قائمًا على هذه الطبقات.

## 6.3 قاموس التلميحات الحالي

| التلميح | المعنى |
| --- | --- |
| `6d 37 6d 64 2d 64` | `m7md-d` بترميز ASCII |
| `.identity` | تعريف الهوية |
| `.text` | الاهتمامات أو ما «ينفذ» فكريًا |
| `.rodata` | traces / evidence / آثار لا تحتاج تعديلًا |
| `.data` | بيانات وحالة قابلة للتحديث |
| `.build` | الأدوات والمشاريع الناتجة |
| `r-x / r-- / rw-` | permissions كلغة بصرية ذات معنى |
| `0x...` | offsets أو عناوين أو IDs عندما يكون لها سياق |
| `$` / block cursor | لغة shell |
| `0x7f454c46` | ELF magic عند استخدامه في سياق مناسب |

## 6.4 عائلات تلميحات يمكن التوسع فيها

هذه ليست عناصر يجب استخدامها؛ هي vocabulary متاحة.

### Binary / file format

- magic bytes
- section names
- offsets
- endianness markers
- headers
- flags
- alignment
- byte counts

### Runtime / OS

- PID / PPID
- session ID
- process state
- exit code
- signals
- file descriptors
- mounts
- `/proc`
- permissions
- uptime إن كان حقيقيًا

### Storage / forensics

مناسب جدًا لأدوات الأقراص والاستعادة:

- LBA
- sector/block ranges
- SMART/NVMe log identifiers
- read retries
- bad regions
- imaging progress
- source → image → analysis pipeline
- checksum / hash state

هنا لا تحتاج استعارة ELF إذا كانت لغة التخزين نفسها أغنى وأكثر صدقًا.

### Networking

- ports
- protocol states
- packet counters
- interface names
- addresses
- routes
- flags

### Build / developer tooling

- commit hash
- build ID
- job state
- branch/ref
- exit status
- pipeline stages

## 6.5 اختبار صلاحية أي تلميح

قبل إضافته اسأل:

1. هل له معنى محدد؟
2. هل له علاقة بالمنتج أو بصاحب الهوية؟
3. هل يعمل حتى لو لم يفهم المستخدم المرجع؟
4. هل يضيف عمقًا بدل تشويش؟
5. هل يمكن توثيق معناه بجملة واحدة؟

إذا كانت الإجابة «لا» على أول سؤالين، فهو غالبًا زخرفة عشوائية وليس تلميحًا.

---

# 7. طريقة البراند في تفسير المواقف

هذه الطبقة أهم من الألوان، لأنها تظهر في أدوات التحليل والتشخيص والتوثيق.

## 7.1 نموذج القراءة

عند تفسير مشكلة أو حالة تقنية، الترتيب المفضل هو:

```text
Observed state
    ↓
What it implies
    ↓
Evidence
    ↓
Boundary / uncertainty
    ↓
Next useful action
```

بالعربية:

1. **ماذا نرى فعلًا؟**
2. **ماذا يعني ذلك غالبًا؟**
3. **ما الدليل؟**
4. **ما الذي لا نعرفه بعد؟**
5. **ما الخطوة التالية ذات أعلى قيمة؟**

## 7.2 لا تقفز من العرض إلى الحكم

بدل:

```text
The drive is dead.
```

الأسلوب المفضل أقرب إلى:

```text
The device enumerates, but reads from several regions time out.
Treat it as unstable until imaging separates media errors from interface or power issues.
```

الهدف ليس الإطالة؛ الهدف فصل **الملاحظة** عن **الاستنتاج**.

## 7.3 فرق دائم بين الحقيقة والاستنتاج

يفضل استخدام لغة صريحة مثل:

- observed
- measured
- reported by device
- inferred
- likely
- not yet verified
- unavailable
- unknown

ولا تستخدم رقم `0` ليعني “لم نستطع الجلب”.

`0` قيمة.

`unknown` حالة مختلفة.

## 7.4 الطبقات قبل المصطلحات

عندما يكون الموضوع معقدًا، ابدأ بصورة البنية:

```text
user action
   ↓
interface
   ↓
logic
   ↓
OS / runtime
   ↓
hardware / protocol
```

ثم انزل إلى الطبقة المؤثرة في المشكلة.

هذا يمنع شرح مصطلحات متناثرة بلا نموذج ذهني.

## 7.5 افصل الـ abstraction عن الحقيقة التي تحته

لا تحطم abstraction لمجرد أنه abstraction.

السؤال هو:

> هل ما تحته يغير القرار؟

إذا لا، ابق في الطبقة الأعلى.

إذا نعم، انزل.

هذه نقطة مهمة حتى لا يتحول حب low-level إلى تعقيد مفتعل.

---

# 8. أسلوب الكتابة والصوت

## 8.1 الخصائص

الصوت:

- مباشر.
- هادئ.
- تقني دون استعراض.
- قصير على السطح.
- عميق عند الطلب.
- لا يكرر نفس المعنى بصيغ متعددة.
- لا يمدح نفسه.
- لا يبالغ في اليقين.

## 8.2 العناوين

يفضل العنوان الذي يصف الشيء نفسه:

```text
GitHub activity
System monitor
ELF → Rust
Tools for real problems
Read errors
Image source
```

على عناوين تسويقية مثل:

```text
Unlock the power of your data
Next-generation intelligent experience
Built for limitless possibilities
```

## 8.3 microcopy

الـ microcopy الجيد:

- قصير.
- يشرح الحالة أو الفعل.
- يمكن أن يحمل شخصية بسيطة.
- لا يحجب الوظيفة.

مثال:

```text
Take another way in
```

مناسب كلصق ثانوي للطرفية.

أما زر الفعل نفسه فيبقى واضحًا:

```text
Terminal
```

## 8.4 الأخطاء

رسالة الخطأ يجب أن تجيب قدر الإمكان عن:

```text
What failed?
Where?
What state are we in now?
What can the user do next?
```

مثال هيكلي:

```text
READ ERROR
LBA 0x001F4000–0x001F47FF
3 retries exhausted
source remains read-only

Next: skip region and continue imaging
```

ليس مطلوبًا استخدام هذا الشكل حرفيًا.

## 8.5 الفكاهة

الفكاهة جزء مسموح من الشخصية وليست default tone.

أفضل شكل لها:

- dry
- contextual
- subtle
- مبنية على فكرة المشروع

COMMANDER مثال واضح: تقارير عسكرية ساخرة لتدقيق pushes.

لا تستخدم الفكاهة في:

- فقدان بيانات.
- تحذير أمني حقيقي.
- عملية destructive.
- فشل قد يكلف المستخدم وقتًا أو مالًا.

## 8.6 العربية والإنجليزية

لا يلزم ترجمة حرفية تحافظ على نفس ترتيب الكلمات.

المطلوب أن تحافظ النسختان على:

- نفس الدقة.
- نفس مستوى الاختصار.
- نفس الثقة.
- نفس hierarchy.

المصطلحات التقنية التي تصبح أضعف بالترجمة يمكن إبقاؤها بالإنجليزية داخل العربية.

---

# 9. البيانات والحالة

## 9.1 الحقيقة أهم من اكتمال الشكل

إذا تعذر جلب القيمة:

```text
--
UNKNOWN
ENODATA
Unavailable
```

أفضل من قيمة تجريبية تبدو حقيقية.

## 9.2 البيانات المؤرخة

كل snapshot يتغير مع الزمن يفضل أن يجيب عن:

- متى جُلب؟
- ما نافذة القياس؟
- ما تعريف المقياس؟

## 9.3 simulated state

المحاكاة مسموحة في تجربة مثل workspace، لكن يجب ألا تختلط ببيانات حقيقية.

مثال:

- simulated PID: مقبول إذا واضح أنه جزء من runtime simulation.
- GitHub contributions مختلقة لتبدو اللوحة ممتلئة: غير مقبول.

## 9.4 status vocabulary

يفضل استخدام حالات ذات معنى تشغيلي واضح:

```text
READY
RUNNING
PAUSED
DEGRADED
FAILED
UNAVAILABLE
UNKNOWN
READ-ONLY
IN DEVELOPMENT
ARCHIVED
```

ولا تستخدم labels غامضة فقط لتبدو تقنية.

---

# 10. فلسفة المنتج والتفاعل

## 10.1 الوظيفة لها الأولوية

أي استعارة بصرية يجب أن تكون قابلة للتجاوز.

إذا كان هناك terminal وbuttons لنفس الوظيفة:

> الأمر والنقر يصلان إلى الحالة نفسها.

الطرفية طريق إضافي، لا gatekeeper.

## 10.2 لا تجعل المستخدم يمثل دور «الهاكر»

لا تجبره على كتابة أمر يعرفه التطبيق أصلًا لمجرد الحفاظ على الثيم.

يمكنه كتابة الأمر إن أراد، لكن يمكنه النقر أيضًا.

## 10.3 state should be inspectable

المنتج القوي في هذه الهوية يجعل حالته مفهومة:

- ما المفتوح؟
- ما الذي يعمل؟
- ما المصدر؟
- ما الخطوة الحالية؟
- هل البيانات محفوظة؟
- ما الذي تغير؟

## 10.4 progressive depth

المستخدم يرى أولًا ما يحتاجه.

ثم يستطيع النزول:

```text
summary
  → details
    → raw data
      → logs / bytes / evidence
```

هذا أحد أفضل تطبيقات شخصية البراند.

## 10.5 local-first عندما تكون له قيمة

الهوية تميل إلى الأدوات التي تمنح المستخدم سيطرة واضحة على ما يحدث، خصوصًا عندما يكون التنفيذ المحلي منطقيًا.

لكن local ليس عقيدة. إذا احتاج المنتج خدمة خارجية حقيقية، يوضح ذلك بدل إخفائه.

---

# 11. المعلومات والهندسة البصرية للواجهات

## 11.1 hierarchy

رتب المعلومات حسب أهميتها التشغيلية:

1. الحالة أو المهمة الحالية.
2. الفعل التالي.
3. النتيجة الأساسية.
4. الأدلة أو التفاصيل.
5. metadata.
6. التلميحات والزخارف.

لا تقلب هذا الترتيب لكي يظهر البراند أقوى.

## 11.2 responsive behavior

الهاتف ليس desktop مصغرًا.

- أعد ترتيب الأعمدة.
- اخفِ ما هو ثانوي عند الحاجة.
- افتح التفاصيل عند الطلب.
- لا تصغر لوحة واسعة حتى تصبح النصوص غير قابلة للقراءة.

## 11.3 accessibility

الهوية لا تبرر التضحية بـ:

- contrast
- keyboard navigation
- focus states
- selectable text
- semantic HTML
- alt text
- reduced motion

## 11.4 icons

الأيقونات:

- وظيفية أولًا.
- هندسية وبسيطة.
- يمكن توليدها من أشكال وخطوط بدل مكتبة لامعة.
- لا تحتاج أن تشبه رموز hacking.

العلامة الحالية `▥` والأيقونة الشبكية مثال على توقيع خفيف، وليستا شرطًا لكل مشروع.

---

# 12. تطبيق الهوية حسب نوع المنتج

## 12.1 CLI

أفضل مساحة لإظهار الهوية بدون تكلف.

استخدم:

- حالات واضحة.
- exit codes صحيحة.
- structured output عند الحاجة.
- `--verbose` أو raw mode بدل طباعة كل شيء دائمًا.
- رسائل خطأ دقيقة.

لا تحتاج banner ASCII ضخم في كل تشغيل.

## 12.2 GUI utility

المستوى الافتراضي المقترح: **L1 أو L2**.

استخدم:

- surface داكنة محايدة.
- monospace للقياسات.
- status strip أو inspector.
- التفاصيل الخام في panel قابل للفتح.
- التلميحات المرتبطة بمجال الأداة نفسها.

## 12.3 أداة diagnostics / DFIR / disk recovery

هذه من أكثر البيئات الطبيعية للهوية.

ركز على:

- source integrity
- read-only state
- device identity
- evidence timestamps
- error maps
- raw logs
- imaging stages
- hash verification
- الفرق بين القراءة الحية والصورة المستخرجة

هنا الجمال يأتي تلقائيًا من البيانات الحقيقية؛ لا تحتاج حشوًا بصريًا.

## 12.4 developer tool

استخدم vocabulary من المجال نفسه:

- branch
- commit
- job
- diff
- build
- exit
- artifact
- report

COMMANDER يستطيع زيادة الشخصية بالفكاهة لأنه جزء من فكرته.

## 12.5 library / SDK

قد لا يظهر أي لون أو UI.

البراند يظهر في:

- API نظيف.
- naming واضح.
- errors جيدة.
- README صادق.
- examples قابلة للتشغيل.
- عدم تغليف behavior غامض خلف magic غير موثق.

## 12.6 portfolio / personal site

يمكن استخدام L3 لأن التجربة نفسها جزء من المحتوى.

الموقع الحالي يثبت أن:

- workspace metaphor مناسب.
- الملفات والطرفية والنوافذ يمكن أن تحمل محتوى حقيقيًا.
- النظام لا يحتاج أن يفرض الأوامر على الزائر.
- الحالة التفاعلية نفسها يمكن أن تكون جزءًا من العرض.

لكن حتى هنا يجب أن يصل الزائر إلى المشاريع والأدلة بسرعة.

## 12.7 README / documentation

لا تحول كل README إلى SVG-heavy profile.

في مستودع أداة، الأفضل أن يكون الترتيب عادة:

```text
What it does
Why it exists
Quick start
How it works
Limits
Evidence / examples
Development
```

يمكن إدخال توقيع الهوية في header أو diagrams أو naming فقط.

---

# 13. طريقة عرض المشاريع والتجارب

## 13.1 المشروع

الوصف الجيد يجيب عن:

```text
Problem → Solution → Current state
```

مثال بنيوي:

```text
Hayn
Media tools that stay on your device.
In development.
```

التفاصيل الأطول مكانها صفحة المشروع أو README.

## 13.2 trace / case study

عند عرض تحليل أو RE أو تجربة تقنية، استخدم بنية أعمق:

```text
Context
↓
Question / trust boundary
↓
Initial evidence
↓
Model or hypothesis
↓
Verification
↓
Result
↓
Scope and limits
↓
Published evidence
```

هذا النوع من العرض أقوى للبراند من قائمة skills.

## 13.3 attribution

إذا استُخدم AI، مكتبة، عمل زميل، أو مصدر سابق:

- انسب الدور الحقيقي.
- لا تقلل من العمل.
- لا تضخمه أيضًا.

الهوية تستفيد من الصراحة أكثر من صورة «كتبت كل شيء وحدي».

---

# 14. ما لا يمثل البراند

هذه أمور يجب تجنب ربطها بالهوية افتراضيًا:

- cyberpunk لمجرد cyberpunk.
- green-on-black كقاعدة.
- purple neon.
- glow كثيف.
- Matrix rain.
- fake terminal typing.
- random hex dumps.
- metrics مختلقة.
- “expert / ninja / wizard / guru”.
- progress bars لا تمثل تقدمًا حقيقيًا.
- badges كثيرة بألوان عشوائية.
- skill percentages.
- labels مثل `DEEP`, `SOLID`, `90%` لقياس المعرفة.
- شرح كل easter egg مباشرة.
- forced terminal interaction.
- إخفاء وظيفة بسيطة خلف استعارة معقدة.
- تحويل كل منتج إلى نسخة مصغرة من البورتفوليو.

---

# 15. التوازن بين البساطة والهوية

عند الشك استخدم هذا الاختبار:

### المنتج يحتاج أقل من خمس ثوانٍ لفهمه؟

لا تضف نظامًا بصريًا ثقيلًا.

### المنتج نفسه أداة فحص أو تحليل؟

دع البيانات والحالات تحمل الهوية.

### المشروع showcase أو portfolio؟

يمكن رفع شدة التجربة.

### التلميح لا يفيد إلا إذا شرحت معناه فورًا؟

غالبًا ليس تلميحًا جيدًا.

### إزالة العنصر تجعل الوظيفة أو الشخصية أو المعنى أقوى؟

احذفه.

---

# 16. أنماط جاهزة للتطبيق

## 16.1 Minimal utility

```text
[tool name]
short functional statement

SOURCE      /dev/...
STATE       READY
MODE        READ-ONLY

[ primary action ]

Details ▸
```

لا حاجة لأي ELF أو ASCII.

## 16.2 Technical utility

```text
[tool name]                     SESSION 00:14:22
───────────────────────────────────────────────
SOURCE    nvme0n1
STATE     DEGRADED
MODE      READ-ONLY

[overview]
[map / primary data]

RAW ▸   LOG ▸   EXPORT ▸
```

التلميحات تأتي من domain نفسه.

## 16.3 Immersive page

```text
PERSONAL / SYSTEM
One layer below.
0x7f454c46  r-x

[ workspace / files / terminal / traces ]
```

هذا مستوى تعبير مرتفع ويستخدم عندما التجربة نفسها مقصودة.

---

# 17. نظام القرار للمصمم أو الوكيل

عند بناء شيء جديد تحت هذه الهوية، اتبع الترتيب التالي:

## Step 1 — افهم المنتج

اكتب بجملة واحدة:

```text
The user is here to ________.
```

إذا لم تستطع، لا تبدأ بالبصريات.

## Step 2 — حدد البيانات الحقيقية

ما الذي يعرفه المنتج فعلًا؟

وما الذي:

- inferred
- cached
- simulated
- unknown

## Step 3 — اختر مستوى الهوية

`L0 / L1 / L2 / L3`

ابدأ بالأقل.

## Step 4 — اختر vocabulary من المجال

لا تبدأ بقاموس ELF دائمًا.

أداة تخزين → storage vocabulary.

أداة شبكات → network vocabulary.

أداة build → pipeline vocabulary.

## Step 5 — أضف توقيعًا واحدًا أو اثنين

مثال:

- byte sequence.
- path.
- section name.
- status language.
- small icon mark.

ليس كلها معًا تلقائيًا.

## Step 6 — اختبر بدون الزخارف

أخفِ:

- الخلفية.
- ASCII.
- التلميحات.
- animation.

إذا انهارت الشخصية أو قابلية الاستخدام، أصلح البنية أولًا.

## Step 7 — اختبر الصدق

- هل أي رقم مختلق؟
- هل zero يعني unknown؟
- هل simulation يبدو كواقع؟
- هل الوصف يدعي أكثر مما تثبته الأدلة؟

## Step 8 — اختبر الاكتشاف

المستخدم العادي يجب أن يفهم المنتج.

المستخدم التقني يستطيع اكتشاف طبقة إضافية.

كلاهما يجب أن ينجح.

---

# 18. قواعد مختصرة للـ AI / design agents

عند إعطاء هذا الملف لوكيل يبني منتجًا:

```text
Do not turn every surface into a terminal.
Do not add random hexadecimal, fake metrics or hacker decoration.
Preserve the product's real information architecture first.
Use the lowest brand-intensity level that fits the task.
Prefer meaningful machine/system references tied to the product domain.
Keep visible copy concise; move depth behind details, raw views or documentation.
Separate observed facts from inference and unknown state.
Never fabricate data to make the interface look complete.
Easter eggs should be discoverable, not explained beside themselves.
Function must remain usable without understanding the references.
```

---

# 19. Checklist قبل اعتماد أي تصميم أو نص

## Core

- [ ] هل المنتج يحل المشكلة بوضوح قبل استعراض الهوية؟
- [ ] هل كل رقم وحالة صادق؟
- [ ] هل unknown منفصل عن zero؟
- [ ] هل النص مباشر وغير تسويقي؟
- [ ] هل التفاصيل التقنية لها دليل أو سياق؟

## Visual

- [ ] هل الواجهة هادئة بدل flashy؟
- [ ] هل hierarchy واضح؟
- [ ] هل monospace مستخدم حيث يفيد؟
- [ ] هل اللون وظيفي؟
- [ ] هل الهاتف يعاد ترتيبه بدل تصغيره؟

## Hints

- [ ] هل كل تلميح له معنى؟
- [ ] هل يرتبط بالمنتج أو الهوية فعلًا؟
- [ ] هل يعمل المنتج بدونه؟
- [ ] هل تركناه قابلًا للاكتشاف؟
- [ ] هل تجنبنا random hacker aesthetics؟

## Voice

- [ ] هل فصلنا الحقيقة عن الاستنتاج؟
- [ ] هل ذكرنا حدود النتيجة عند الحاجة؟
- [ ] هل هناك فعل تالٍ واضح في الأخطاء؟
- [ ] هل الفكاهة مناسبة للموقف؟
- [ ] هل اختصرنا السطح وتركنا العمق عند الطلب؟

---

# 20. أمثلة على القرارات الصحيحة والخاطئة

## حالة: أداة تحويل ملفات

### خطأ

إضافة memory addresses وELF sections فقط لكي تبدو أداة `m7md-d`.

### أنسب

إظهار:

- input format
- codec
- dimensions
- bit depth
- output size
- conversion pipeline
- exact warnings

ثم يمكن إضافة توقيع بصري صغير من الهوية بدون خلط domain آخر.

---

## حالة: أداة استعادة SSD

### خطأ

واجهة جميلة تقول فقط:

```text
Disk health: BAD
```

### أنسب

تسمح للمستخدم بالنزول تدريجيًا:

```text
Device state
→ SMART / NVMe evidence
→ power / interface observations
→ read map
→ imaging state
→ raw tool output
```

وهنا لغة LBA والقطاعات والأخطاء والصورة الخام هي البراند الطبيعي نفسه.

---

## حالة: مكتبة برمجية

### خطأ

إجبار branding بصري داخل API.

### أنسب

API صغير، predictable، errors جيدة، README دقيق، وتوقيع خفيف في المستودع فقط.

---

## حالة: البورتفوليو

### خطأ

landing page عادية ثم إضافة glow وهيكسا فوقها.

### أنسب

التجربة نفسها تصبح نظامًا يمكن استكشافه، مع مشاريع حقيقية وملفات وحالة وتلميحات لها معنى.

---

# 21. خلاصة الهوية في سطر واحد

> **A quiet technical system that rewards inspection.**

أو بمعناها العربي:

> **نظام تقني هادئ؛ واضح من السطح، ويكافئ من يقرر أن ينظر طبقة أعمق.**

هذا هو المرجع عند التعارض بين أي قرارين بصريين أو تحريريين.

إذا كان القرار يجعل المنتج أكثر ضجيجًا لكنه أقل قابلية للفهم أو الفحص، فهو غالبًا ضد الهوية.

إذا كان يجعله أكثر دقة، أو يكشف بنيته بطريقة محسوبة، أو يضيف طبقة يمكن اكتشافها دون إفساد السطح، فهو غالبًا داخل الهوية.

---

# 22. مصدر هذا المرجع

تم اشتقاق هذا الملف من المواد الحالية للهوية، وليس من تصور منفصل عنها:

- `README-IDENTITY.md`
- `BRAND-STUDY.md`
- `REDESIGN-PLAN.md`
- مستودع GitHub الحالي `m7md-d`
- النسخة المصدرة من البورتفوليو الحالي

عند تعارض تنفيذ قديم مع هذا المرجع، يفضل النظر إلى **المبدأ** قبل نسخ الشكل حرفيًا.
