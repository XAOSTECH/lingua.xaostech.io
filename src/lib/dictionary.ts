/**
 * =============================================================================
 * lingua.xaostech.io - Dictionary Management Library
 * =============================================================================
 * Provides fast, zero-cost translations for common words using static dictionaries.
 * Falls back to OpenAI API for words not in dictionary.
 * 
 * Dictionary Format:
 * {
 *   "word": {
 *     "translations": { "es": "palabra", "fr": "mot", "de": "wort" },
 *     "etymology": { ... },
 *     "pos": "noun",
 *     "frequency": 1
 *   }
 * }
 * =============================================================================
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface DictionaryEntry {
    translations: Record<string, string>;
    etymology?: EtymologyData;
    pos?: string; // Part of speech
    frequency?: number; // Usage frequency rank (1 = most common)
    variants?: string[]; // Alternate forms
}

export interface EtymologyData {
    origin: string;
    originalForm?: string;
    meaning?: string;
    root?: string;
    rootLanguage?: string;
    cognates?: Array<{ word: string; language: string }>;
    firstUse?: string;
    evolution?: string[];
}

export interface Dictionary {
    meta: {
        sourceLanguage: string;
        version: string;
        lastUpdated: string;
        wordCount: number;
        sources: string[];
    };
    words: Record<string, DictionaryEntry>;
}

export interface TranslationResult {
    original: string;
    translated: string;
    source: 'dictionary' | 'cache' | 'api';
    etymology?: EtymologyData;
    confidence: number;
}

// =============================================================================
// EMBEDDED CORE DICTIONARY - Top 500 most common words
// =============================================================================
// This is embedded directly for instant access without KV/R2 lookup
// Larger dictionaries are loaded from KV on-demand

const CORE_DICTIONARY: Record<string, DictionaryEntry> = {
    // Greetings & Common Phrases
    "hello": {
        translations: { es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", ja: "こんにちは", zh: "你好", ko: "안녕하세요", ar: "مرحبا", ru: "привет" },
        etymology: { origin: "Old English", originalForm: "hǣl", meaning: "health, wholeness", root: "*hailaz", rootLanguage: "Proto-Germanic", cognates: [{ word: "heil", language: "German" }, { word: "heel", language: "Dutch" }], firstUse: "1826 (as greeting)" },
        pos: "interjection",
        frequency: 1
    },
    "goodbye": {
        translations: { es: "adiós", fr: "au revoir", de: "auf wiedersehen", it: "arrivederci", pt: "adeus", ja: "さようなら", zh: "再见", ko: "안녕히 가세요", ar: "مع السلامة", ru: "до свидания" },
        etymology: { origin: "English", originalForm: "God be with ye", meaning: "God be with you", firstUse: "1570s" },
        pos: "interjection",
        frequency: 2
    },
    "yes": {
        translations: { es: "sí", fr: "oui", de: "ja", it: "sì", pt: "sim", ja: "はい", zh: "是", ko: "네", ar: "نعم", ru: "да" },
        etymology: { origin: "Old English", originalForm: "gēse", meaning: "so be it", root: "*gea swa", rootLanguage: "Proto-Germanic" },
        pos: "adverb",
        frequency: 3
    },
    "no": {
        translations: { es: "no", fr: "non", de: "nein", it: "no", pt: "não", ja: "いいえ", zh: "不", ko: "아니요", ar: "لا", ru: "нет" },
        etymology: { origin: "Old English", originalForm: "nā", meaning: "not ever", root: "*ne", rootLanguage: "Proto-Indo-European" },
        pos: "adverb",
        frequency: 4
    },
    "please": {
        translations: { es: "por favor", fr: "s'il vous plaît", de: "bitte", it: "per favore", pt: "por favor", ja: "お願いします", zh: "请", ko: "제발", ar: "من فضلك", ru: "пожалуйста" },
        etymology: { origin: "Old French", originalForm: "plaisir", meaning: "to please", root: "placere", rootLanguage: "Latin" },
        pos: "adverb",
        frequency: 5
    },
    "thank you": {
        translations: { es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", ja: "ありがとう", zh: "谢谢", ko: "감사합니다", ar: "شكرا", ru: "спасибо" },
        etymology: { origin: "Old English", originalForm: "þancian", meaning: "to give thanks", root: "*þankaz", rootLanguage: "Proto-Germanic" },
        pos: "phrase",
        frequency: 6
    },
    "thanks": {
        translations: { es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", ja: "ありがとう", zh: "谢谢", ko: "감사합니다", ar: "شكرا", ru: "спасибо" },
        pos: "noun",
        frequency: 7
    },

    // Pronouns
    "i": {
        translations: { es: "yo", fr: "je", de: "ich", it: "io", pt: "eu", ja: "私", zh: "我", ko: "나", ar: "أنا", ru: "я" },
        etymology: { origin: "Old English", originalForm: "ic", root: "*éǵh₂", rootLanguage: "Proto-Indo-European" },
        pos: "pronoun",
        frequency: 8
    },
    "you": {
        translations: { es: "tú", fr: "tu/vous", de: "du/Sie", it: "tu/Lei", pt: "tu/você", ja: "あなた", zh: "你", ko: "너/당신", ar: "أنت", ru: "ты/вы" },
        etymology: { origin: "Old English", originalForm: "ēow", root: "*jūz", rootLanguage: "Proto-Germanic" },
        pos: "pronoun",
        frequency: 9
    },
    "he": {
        translations: { es: "él", fr: "il", de: "er", it: "lui", pt: "ele", ja: "彼", zh: "他", ko: "그", ar: "هو", ru: "он" },
        pos: "pronoun",
        frequency: 10
    },
    "she": {
        translations: { es: "ella", fr: "elle", de: "sie", it: "lei", pt: "ela", ja: "彼女", zh: "她", ko: "그녀", ar: "هي", ru: "она" },
        pos: "pronoun",
        frequency: 11
    },
    "it": {
        translations: { es: "eso", fr: "ça/il/elle", de: "es", it: "esso", pt: "isso", ja: "それ", zh: "它", ko: "그것", ar: "هو/هي", ru: "оно" },
        pos: "pronoun",
        frequency: 12
    },
    "we": {
        translations: { es: "nosotros", fr: "nous", de: "wir", it: "noi", pt: "nós", ja: "私たち", zh: "我们", ko: "우리", ar: "نحن", ru: "мы" },
        pos: "pronoun",
        frequency: 13
    },
    "they": {
        translations: { es: "ellos", fr: "ils/elles", de: "sie", it: "loro", pt: "eles", ja: "彼ら", zh: "他们", ko: "그들", ar: "هم", ru: "они" },
        pos: "pronoun",
        frequency: 14
    },

    // Common Verbs
    "be": {
        translations: { es: "ser/estar", fr: "être", de: "sein", it: "essere", pt: "ser/estar", ja: "です/いる", zh: "是", ko: "이다", ar: "يكون", ru: "быть" },
        etymology: { origin: "Old English", originalForm: "bēon", root: "*bʰuH-", rootLanguage: "Proto-Indo-European", meaning: "to grow, become" },
        pos: "verb",
        frequency: 15
    },
    "have": {
        translations: { es: "tener", fr: "avoir", de: "haben", it: "avere", pt: "ter", ja: "持つ", zh: "有", ko: "가지다", ar: "يملك", ru: "иметь" },
        etymology: { origin: "Old English", originalForm: "habban", root: "*habēną", rootLanguage: "Proto-Germanic" },
        pos: "verb",
        frequency: 16
    },
    "do": {
        translations: { es: "hacer", fr: "faire", de: "tun/machen", it: "fare", pt: "fazer", ja: "する", zh: "做", ko: "하다", ar: "يفعل", ru: "делать" },
        pos: "verb",
        frequency: 17
    },
    "say": {
        translations: { es: "decir", fr: "dire", de: "sagen", it: "dire", pt: "dizer", ja: "言う", zh: "说", ko: "말하다", ar: "يقول", ru: "сказать" },
        pos: "verb",
        frequency: 18
    },
    "go": {
        translations: { es: "ir", fr: "aller", de: "gehen", it: "andare", pt: "ir", ja: "行く", zh: "去", ko: "가다", ar: "يذهب", ru: "идти" },
        etymology: { origin: "Old English", originalForm: "gān", root: "*ǵʰeh₁-", rootLanguage: "Proto-Indo-European", meaning: "to go, leave" },
        pos: "verb",
        frequency: 19
    },
    "get": {
        translations: { es: "obtener", fr: "obtenir", de: "bekommen", it: "ottenere", pt: "obter", ja: "得る", zh: "得到", ko: "얻다", ar: "يحصل", ru: "получать" },
        pos: "verb",
        frequency: 20
    },
    "make": {
        translations: { es: "hacer", fr: "faire", de: "machen", it: "fare", pt: "fazer", ja: "作る", zh: "做", ko: "만들다", ar: "يصنع", ru: "делать" },
        pos: "verb",
        frequency: 21
    },
    "know": {
        translations: { es: "saber/conocer", fr: "savoir/connaître", de: "wissen/kennen", it: "sapere/conoscere", pt: "saber/conhecer", ja: "知る", zh: "知道", ko: "알다", ar: "يعرف", ru: "знать" },
        pos: "verb",
        frequency: 22
    },
    "think": {
        translations: { es: "pensar", fr: "penser", de: "denken", it: "pensare", pt: "pensar", ja: "思う", zh: "想", ko: "생각하다", ar: "يفكر", ru: "думать" },
        pos: "verb",
        frequency: 23
    },
    "take": {
        translations: { es: "tomar", fr: "prendre", de: "nehmen", it: "prendere", pt: "tomar", ja: "取る", zh: "拿", ko: "가져가다", ar: "يأخذ", ru: "брать" },
        pos: "verb",
        frequency: 24
    },
    "see": {
        translations: { es: "ver", fr: "voir", de: "sehen", it: "vedere", pt: "ver", ja: "見る", zh: "看", ko: "보다", ar: "يرى", ru: "видеть" },
        pos: "verb",
        frequency: 25
    },
    "come": {
        translations: { es: "venir", fr: "venir", de: "kommen", it: "venire", pt: "vir", ja: "来る", zh: "来", ko: "오다", ar: "يأتي", ru: "приходить" },
        pos: "verb",
        frequency: 26
    },
    "want": {
        translations: { es: "querer", fr: "vouloir", de: "wollen", it: "volere", pt: "querer", ja: "欲しい", zh: "想要", ko: "원하다", ar: "يريد", ru: "хотеть" },
        pos: "verb",
        frequency: 27
    },
    "use": {
        translations: { es: "usar", fr: "utiliser", de: "benutzen", it: "usare", pt: "usar", ja: "使う", zh: "使用", ko: "사용하다", ar: "يستخدم", ru: "использовать" },
        pos: "verb",
        frequency: 28
    },
    "find": {
        translations: { es: "encontrar", fr: "trouver", de: "finden", it: "trovare", pt: "encontrar", ja: "見つける", zh: "找到", ko: "찾다", ar: "يجد", ru: "находить" },
        pos: "verb",
        frequency: 29
    },
    "give": {
        translations: { es: "dar", fr: "donner", de: "geben", it: "dare", pt: "dar", ja: "与える", zh: "给", ko: "주다", ar: "يعطي", ru: "давать" },
        pos: "verb",
        frequency: 30
    },
    "tell": {
        translations: { es: "decir", fr: "dire", de: "erzählen", it: "dire", pt: "contar", ja: "話す", zh: "告诉", ko: "말하다", ar: "يخبر", ru: "рассказывать" },
        pos: "verb",
        frequency: 31
    },
    "work": {
        translations: { es: "trabajar", fr: "travailler", de: "arbeiten", it: "lavorare", pt: "trabalhar", ja: "働く", zh: "工作", ko: "일하다", ar: "يعمل", ru: "работать" },
        pos: "verb",
        frequency: 32
    },
    "call": {
        translations: { es: "llamar", fr: "appeler", de: "rufen", it: "chiamare", pt: "chamar", ja: "呼ぶ", zh: "叫", ko: "부르다", ar: "يدعو", ru: "звать" },
        pos: "verb",
        frequency: 33
    },
    "try": {
        translations: { es: "intentar", fr: "essayer", de: "versuchen", it: "provare", pt: "tentar", ja: "試す", zh: "尝试", ko: "시도하다", ar: "يحاول", ru: "пробовать" },
        pos: "verb",
        frequency: 34
    },
    "ask": {
        translations: { es: "preguntar", fr: "demander", de: "fragen", it: "chiedere", pt: "perguntar", ja: "聞く", zh: "问", ko: "묻다", ar: "يسأل", ru: "спрашивать" },
        pos: "verb",
        frequency: 35
    },
    "need": {
        translations: { es: "necesitar", fr: "avoir besoin", de: "brauchen", it: "avere bisogno", pt: "precisar", ja: "必要とする", zh: "需要", ko: "필요하다", ar: "يحتاج", ru: "нуждаться" },
        pos: "verb",
        frequency: 36
    },
    "feel": {
        translations: { es: "sentir", fr: "sentir", de: "fühlen", it: "sentire", pt: "sentir", ja: "感じる", zh: "感觉", ko: "느끼다", ar: "يشعر", ru: "чувствовать" },
        pos: "verb",
        frequency: 37
    },
    "become": {
        translations: { es: "convertirse", fr: "devenir", de: "werden", it: "diventare", pt: "tornar-se", ja: "なる", zh: "变成", ko: "되다", ar: "يصبح", ru: "становиться" },
        pos: "verb",
        frequency: 38
    },
    "leave": {
        translations: { es: "dejar", fr: "laisser", de: "verlassen", it: "lasciare", pt: "deixar", ja: "去る", zh: "离开", ko: "떠나다", ar: "يترك", ru: "оставлять" },
        pos: "verb",
        frequency: 39
    },
    "put": {
        translations: { es: "poner", fr: "mettre", de: "legen/stellen", it: "mettere", pt: "colocar", ja: "置く", zh: "放", ko: "놓다", ar: "يضع", ru: "класть" },
        pos: "verb",
        frequency: 40
    },
    "mean": {
        translations: { es: "significar", fr: "signifier", de: "bedeuten", it: "significare", pt: "significar", ja: "意味する", zh: "意思是", ko: "의미하다", ar: "يعني", ru: "означать" },
        pos: "verb",
        frequency: 41
    },
    "keep": {
        translations: { es: "guardar", fr: "garder", de: "behalten", it: "tenere", pt: "manter", ja: "保つ", zh: "保持", ko: "유지하다", ar: "يحافظ", ru: "хранить" },
        pos: "verb",
        frequency: 42
    },
    "let": {
        translations: { es: "dejar", fr: "laisser", de: "lassen", it: "lasciare", pt: "deixar", ja: "させる", zh: "让", ko: "하게하다", ar: "يدع", ru: "позволять" },
        pos: "verb",
        frequency: 43
    },
    "begin": {
        translations: { es: "comenzar", fr: "commencer", de: "beginnen", it: "cominciare", pt: "começar", ja: "始める", zh: "开始", ko: "시작하다", ar: "يبدأ", ru: "начинать" },
        pos: "verb",
        frequency: 44
    },
    "seem": {
        translations: { es: "parecer", fr: "sembler", de: "scheinen", it: "sembrare", pt: "parecer", ja: "見える", zh: "似乎", ko: "보이다", ar: "يبدو", ru: "казаться" },
        pos: "verb",
        frequency: 45
    },
    "help": {
        translations: { es: "ayudar", fr: "aider", de: "helfen", it: "aiutare", pt: "ajudar", ja: "助ける", zh: "帮助", ko: "돕다", ar: "يساعد", ru: "помогать" },
        pos: "verb",
        frequency: 46
    },
    "show": {
        translations: { es: "mostrar", fr: "montrer", de: "zeigen", it: "mostrare", pt: "mostrar", ja: "見せる", zh: "显示", ko: "보여주다", ar: "يظهر", ru: "показывать" },
        pos: "verb",
        frequency: 47
    },
    "hear": {
        translations: { es: "oír", fr: "entendre", de: "hören", it: "sentire", pt: "ouvir", ja: "聞く", zh: "听", ko: "듣다", ar: "يسمع", ru: "слышать" },
        pos: "verb",
        frequency: 48
    },
    "play": {
        translations: { es: "jugar", fr: "jouer", de: "spielen", it: "giocare", pt: "jogar", ja: "遊ぶ", zh: "玩", ko: "놀다", ar: "يلعب", ru: "играть" },
        pos: "verb",
        frequency: 49
    },
    "run": {
        translations: { es: "correr", fr: "courir", de: "laufen", it: "correre", pt: "correr", ja: "走る", zh: "跑", ko: "달리다", ar: "يجري", ru: "бежать" },
        pos: "verb",
        frequency: 50
    },
    "move": {
        translations: { es: "mover", fr: "déplacer", de: "bewegen", it: "muovere", pt: "mover", ja: "動く", zh: "移动", ko: "움직이다", ar: "يتحرك", ru: "двигать" },
        pos: "verb",
        frequency: 51
    },
    "live": {
        translations: { es: "vivir", fr: "vivre", de: "leben", it: "vivere", pt: "viver", ja: "住む", zh: "住", ko: "살다", ar: "يعيش", ru: "жить" },
        pos: "verb",
        frequency: 52
    },
    "believe": {
        translations: { es: "creer", fr: "croire", de: "glauben", it: "credere", pt: "acreditar", ja: "信じる", zh: "相信", ko: "믿다", ar: "يعتقد", ru: "верить" },
        pos: "verb",
        frequency: 53
    },
    "bring": {
        translations: { es: "traer", fr: "apporter", de: "bringen", it: "portare", pt: "trazer", ja: "持ってくる", zh: "带来", ko: "가져오다", ar: "يجلب", ru: "приносить" },
        pos: "verb",
        frequency: 54
    },
    "happen": {
        translations: { es: "suceder", fr: "arriver", de: "geschehen", it: "accadere", pt: "acontecer", ja: "起こる", zh: "发生", ko: "일어나다", ar: "يحدث", ru: "случаться" },
        pos: "verb",
        frequency: 55
    },
    "write": {
        translations: { es: "escribir", fr: "écrire", de: "schreiben", it: "scrivere", pt: "escrever", ja: "書く", zh: "写", ko: "쓰다", ar: "يكتب", ru: "писать" },
        pos: "verb",
        frequency: 56
    },
    "sit": {
        translations: { es: "sentarse", fr: "s'asseoir", de: "sitzen", it: "sedersi", pt: "sentar", ja: "座る", zh: "坐", ko: "앉다", ar: "يجلس", ru: "сидеть" },
        pos: "verb",
        frequency: 57
    },
    "stand": {
        translations: { es: "estar de pie", fr: "se tenir debout", de: "stehen", it: "stare in piedi", pt: "ficar de pé", ja: "立つ", zh: "站", ko: "서다", ar: "يقف", ru: "стоять" },
        pos: "verb",
        frequency: 58
    },
    "lose": {
        translations: { es: "perder", fr: "perdre", de: "verlieren", it: "perdere", pt: "perder", ja: "失う", zh: "失去", ko: "잃다", ar: "يخسر", ru: "терять" },
        pos: "verb",
        frequency: 59
    },
    "pay": {
        translations: { es: "pagar", fr: "payer", de: "bezahlen", it: "pagare", pt: "pagar", ja: "払う", zh: "支付", ko: "지불하다", ar: "يدفع", ru: "платить" },
        pos: "verb",
        frequency: 60
    },
    "meet": {
        translations: { es: "conocer", fr: "rencontrer", de: "treffen", it: "incontrare", pt: "conhecer", ja: "会う", zh: "见面", ko: "만나다", ar: "يقابل", ru: "встречать" },
        pos: "verb",
        frequency: 61
    },
    "include": {
        translations: { es: "incluir", fr: "inclure", de: "einschließen", it: "includere", pt: "incluir", ja: "含む", zh: "包括", ko: "포함하다", ar: "يشمل", ru: "включать" },
        pos: "verb",
        frequency: 62
    },
    "continue": {
        translations: { es: "continuar", fr: "continuer", de: "fortsetzen", it: "continuare", pt: "continuar", ja: "続ける", zh: "继续", ko: "계속하다", ar: "يستمر", ru: "продолжать" },
        pos: "verb",
        frequency: 63
    },
    "learn": {
        translations: { es: "aprender", fr: "apprendre", de: "lernen", it: "imparare", pt: "aprender", ja: "学ぶ", zh: "学习", ko: "배우다", ar: "يتعلم", ru: "учиться" },
        pos: "verb",
        frequency: 64
    },
    "change": {
        translations: { es: "cambiar", fr: "changer", de: "ändern", it: "cambiare", pt: "mudar", ja: "変える", zh: "改变", ko: "바꾸다", ar: "يغير", ru: "менять" },
        pos: "verb",
        frequency: 65
    },
    "watch": {
        translations: { es: "mirar", fr: "regarder", de: "schauen", it: "guardare", pt: "assistir", ja: "見る", zh: "观看", ko: "보다", ar: "يشاهد", ru: "смотреть" },
        pos: "verb",
        frequency: 66
    },
    "follow": {
        translations: { es: "seguir", fr: "suivre", de: "folgen", it: "seguire", pt: "seguir", ja: "従う", zh: "跟随", ko: "따르다", ar: "يتبع", ru: "следовать" },
        pos: "verb",
        frequency: 67
    },
    "stop": {
        translations: { es: "parar", fr: "arrêter", de: "stoppen", it: "fermare", pt: "parar", ja: "止める", zh: "停止", ko: "멈추다", ar: "يتوقف", ru: "останавливать" },
        pos: "verb",
        frequency: 68
    },
    "create": {
        translations: { es: "crear", fr: "créer", de: "erschaffen", it: "creare", pt: "criar", ja: "作成する", zh: "创造", ko: "만들다", ar: "يخلق", ru: "создавать" },
        pos: "verb",
        frequency: 69
    },
    "speak": {
        translations: { es: "hablar", fr: "parler", de: "sprechen", it: "parlare", pt: "falar", ja: "話す", zh: "说话", ko: "말하다", ar: "يتكلم", ru: "говорить" },
        pos: "verb",
        frequency: 70
    },
    "read": {
        translations: { es: "leer", fr: "lire", de: "lesen", it: "leggere", pt: "ler", ja: "読む", zh: "读", ko: "읽다", ar: "يقرأ", ru: "читать" },
        pos: "verb",
        frequency: 71
    },
    "spend": {
        translations: { es: "gastar", fr: "dépenser", de: "ausgeben", it: "spendere", pt: "gastar", ja: "費やす", zh: "花费", ko: "보내다", ar: "ينفق", ru: "тратить" },
        pos: "verb",
        frequency: 72
    },
    "grow": {
        translations: { es: "crecer", fr: "grandir", de: "wachsen", it: "crescere", pt: "crescer", ja: "成長する", zh: "成长", ko: "자라다", ar: "ينمو", ru: "расти" },
        pos: "verb",
        frequency: 73
    },
    "open": {
        translations: { es: "abrir", fr: "ouvrir", de: "öffnen", it: "aprire", pt: "abrir", ja: "開ける", zh: "打开", ko: "열다", ar: "يفتح", ru: "открывать" },
        pos: "verb",
        frequency: 74
    },
    "walk": {
        translations: { es: "caminar", fr: "marcher", de: "gehen", it: "camminare", pt: "andar", ja: "歩く", zh: "走", ko: "걷다", ar: "يمشي", ru: "ходить" },
        pos: "verb",
        frequency: 75
    },
    "win": {
        translations: { es: "ganar", fr: "gagner", de: "gewinnen", it: "vincere", pt: "ganhar", ja: "勝つ", zh: "赢", ko: "이기다", ar: "يفوز", ru: "выигрывать" },
        pos: "verb",
        frequency: 76
    },
    "teach": {
        translations: { es: "enseñar", fr: "enseigner", de: "unterrichten", it: "insegnare", pt: "ensinar", ja: "教える", zh: "教", ko: "가르치다", ar: "يعلم", ru: "учить" },
        pos: "verb",
        frequency: 77
    },
    "offer": {
        translations: { es: "ofrecer", fr: "offrir", de: "anbieten", it: "offrire", pt: "oferecer", ja: "提供する", zh: "提供", ko: "제공하다", ar: "يقدم", ru: "предлагать" },
        pos: "verb",
        frequency: 78
    },
    "remember": {
        translations: { es: "recordar", fr: "se souvenir", de: "sich erinnern", it: "ricordare", pt: "lembrar", ja: "覚えている", zh: "记得", ko: "기억하다", ar: "يتذكر", ru: "помнить" },
        pos: "verb",
        frequency: 79
    },
    "love": {
        translations: { es: "amar", fr: "aimer", de: "lieben", it: "amare", pt: "amar", ja: "愛する", zh: "爱", ko: "사랑하다", ar: "يحب", ru: "любить" },
        etymology: { origin: "Old English", originalForm: "lufu", root: "*lubō", rootLanguage: "Proto-Germanic" },
        pos: "verb",
        frequency: 80
    },
    "eat": {
        translations: { es: "comer", fr: "manger", de: "essen", it: "mangiare", pt: "comer", ja: "食べる", zh: "吃", ko: "먹다", ar: "يأكل", ru: "есть" },
        pos: "verb",
        frequency: 81
    },
    "drink": {
        translations: { es: "beber", fr: "boire", de: "trinken", it: "bere", pt: "beber", ja: "飲む", zh: "喝", ko: "마시다", ar: "يشرب", ru: "пить" },
        pos: "verb",
        frequency: 82
    },
    "sleep": {
        translations: { es: "dormir", fr: "dormir", de: "schlafen", it: "dormire", pt: "dormir", ja: "眠る", zh: "睡觉", ko: "자다", ar: "ينام", ru: "спать" },
        pos: "verb",
        frequency: 83
    },
    "buy": {
        translations: { es: "comprar", fr: "acheter", de: "kaufen", it: "comprare", pt: "comprar", ja: "買う", zh: "买", ko: "사다", ar: "يشتري", ru: "покупать" },
        pos: "verb",
        frequency: 84
    },
    "sell": {
        translations: { es: "vender", fr: "vendre", de: "verkaufen", it: "vendere", pt: "vender", ja: "売る", zh: "卖", ko: "팔다", ar: "يبيع", ru: "продавать" },
        pos: "verb",
        frequency: 85
    },

    // Common Nouns
    "time": {
        translations: { es: "tiempo", fr: "temps", de: "Zeit", it: "tempo", pt: "tempo", ja: "時間", zh: "时间", ko: "시간", ar: "وقت", ru: "время" },
        pos: "noun",
        frequency: 86
    },
    "year": {
        translations: { es: "año", fr: "année", de: "Jahr", it: "anno", pt: "ano", ja: "年", zh: "年", ko: "년", ar: "سنة", ru: "год" },
        pos: "noun",
        frequency: 87
    },
    "people": {
        translations: { es: "gente", fr: "gens", de: "Leute", it: "gente", pt: "pessoas", ja: "人々", zh: "人们", ko: "사람들", ar: "ناس", ru: "люди" },
        pos: "noun",
        frequency: 88
    },
    "way": {
        translations: { es: "manera", fr: "façon", de: "Weg", it: "modo", pt: "maneira", ja: "方法", zh: "方式", ko: "방법", ar: "طريقة", ru: "способ" },
        pos: "noun",
        frequency: 89
    },
    "day": {
        translations: { es: "día", fr: "jour", de: "Tag", it: "giorno", pt: "dia", ja: "日", zh: "天", ko: "날", ar: "يوم", ru: "день" },
        pos: "noun",
        frequency: 90
    },
    "man": {
        translations: { es: "hombre", fr: "homme", de: "Mann", it: "uomo", pt: "homem", ja: "男", zh: "男人", ko: "남자", ar: "رجل", ru: "мужчина" },
        pos: "noun",
        frequency: 91
    },
    "woman": {
        translations: { es: "mujer", fr: "femme", de: "Frau", it: "donna", pt: "mulher", ja: "女", zh: "女人", ko: "여자", ar: "امرأة", ru: "женщина" },
        pos: "noun",
        frequency: 92
    },
    "child": {
        translations: { es: "niño", fr: "enfant", de: "Kind", it: "bambino", pt: "criança", ja: "子供", zh: "孩子", ko: "아이", ar: "طفل", ru: "ребёнок" },
        pos: "noun",
        frequency: 93
    },
    "world": {
        translations: { es: "mundo", fr: "monde", de: "Welt", it: "mondo", pt: "mundo", ja: "世界", zh: "世界", ko: "세계", ar: "عالم", ru: "мир" },
        pos: "noun",
        frequency: 94
    },
    "life": {
        translations: { es: "vida", fr: "vie", de: "Leben", it: "vita", pt: "vida", ja: "人生", zh: "生活", ko: "인생", ar: "حياة", ru: "жизнь" },
        pos: "noun",
        frequency: 95
    },
    "hand": {
        translations: { es: "mano", fr: "main", de: "Hand", it: "mano", pt: "mão", ja: "手", zh: "手", ko: "손", ar: "يد", ru: "рука" },
        pos: "noun",
        frequency: 96
    },
    "part": {
        translations: { es: "parte", fr: "partie", de: "Teil", it: "parte", pt: "parte", ja: "部分", zh: "部分", ko: "부분", ar: "جزء", ru: "часть" },
        pos: "noun",
        frequency: 97
    },
    "place": {
        translations: { es: "lugar", fr: "lieu", de: "Ort", it: "posto", pt: "lugar", ja: "場所", zh: "地方", ko: "장소", ar: "مكان", ru: "место" },
        pos: "noun",
        frequency: 98
    },
    "case": {
        translations: { es: "caso", fr: "cas", de: "Fall", it: "caso", pt: "caso", ja: "場合", zh: "情况", ko: "경우", ar: "حالة", ru: "случай" },
        pos: "noun",
        frequency: 99
    },
    "week": {
        translations: { es: "semana", fr: "semaine", de: "Woche", it: "settimana", pt: "semana", ja: "週", zh: "周", ko: "주", ar: "أسبوع", ru: "неделя" },
        pos: "noun",
        frequency: 100
    },
    "company": {
        translations: { es: "empresa", fr: "entreprise", de: "Unternehmen", it: "azienda", pt: "empresa", ja: "会社", zh: "公司", ko: "회사", ar: "شركة", ru: "компания" },
        pos: "noun",
        frequency: 101
    },
    "system": {
        translations: { es: "sistema", fr: "système", de: "System", it: "sistema", pt: "sistema", ja: "システム", zh: "系统", ko: "시스템", ar: "نظام", ru: "система" },
        pos: "noun",
        frequency: 102
    },
    "program": {
        translations: { es: "programa", fr: "programme", de: "Programm", it: "programma", pt: "programa", ja: "プログラム", zh: "程序", ko: "프로그램", ar: "برنامج", ru: "программа" },
        pos: "noun",
        frequency: 103
    },
    "question": {
        translations: { es: "pregunta", fr: "question", de: "Frage", it: "domanda", pt: "pergunta", ja: "質問", zh: "问题", ko: "질문", ar: "سؤال", ru: "вопрос" },
        pos: "noun",
        frequency: 104
    },
    // "work" as noun omitted - verb form exists, use "labor" instead
    "labor": {
        translations: { es: "labor", fr: "travail", de: "Arbeit", it: "lavoro", pt: "labor", ja: "労働", zh: "劳动", ko: "노동", ar: "عمل", ru: "труд" },
        pos: "noun",
        frequency: 105
    },
    "government": {
        translations: { es: "gobierno", fr: "gouvernement", de: "Regierung", it: "governo", pt: "governo", ja: "政府", zh: "政府", ko: "정부", ar: "حكومة", ru: "правительство" },
        pos: "noun",
        frequency: 106
    },
    "number": {
        translations: { es: "número", fr: "numéro", de: "Nummer", it: "numero", pt: "número", ja: "番号", zh: "号码", ko: "번호", ar: "رقم", ru: "номер" },
        pos: "noun",
        frequency: 107
    },
    "night": {
        translations: { es: "noche", fr: "nuit", de: "Nacht", it: "notte", pt: "noite", ja: "夜", zh: "夜晚", ko: "밤", ar: "ليل", ru: "ночь" },
        pos: "noun",
        frequency: 108
    },
    "point": {
        translations: { es: "punto", fr: "point", de: "Punkt", it: "punto", pt: "ponto", ja: "点", zh: "点", ko: "점", ar: "نقطة", ru: "точка" },
        pos: "noun",
        frequency: 109
    },
    "home": {
        translations: { es: "casa", fr: "maison", de: "Haus", it: "casa", pt: "casa", ja: "家", zh: "家", ko: "집", ar: "منزل", ru: "дом" },
        pos: "noun",
        frequency: 110
    },
    "water": {
        translations: { es: "agua", fr: "eau", de: "Wasser", it: "acqua", pt: "água", ja: "水", zh: "水", ko: "물", ar: "ماء", ru: "вода" },
        etymology: { origin: "Old English", originalForm: "wæter", root: "*wódr̥", rootLanguage: "Proto-Indo-European" },
        pos: "noun",
        frequency: 111
    },
    "room": {
        translations: { es: "habitación", fr: "chambre", de: "Zimmer", it: "stanza", pt: "quarto", ja: "部屋", zh: "房间", ko: "방", ar: "غرفة", ru: "комната" },
        pos: "noun",
        frequency: 112
    },
    "mother": {
        translations: { es: "madre", fr: "mère", de: "Mutter", it: "madre", pt: "mãe", ja: "母", zh: "母亲", ko: "어머니", ar: "أم", ru: "мать" },
        etymology: { origin: "Old English", originalForm: "mōdor", root: "*méh₂tēr", rootLanguage: "Proto-Indo-European" },
        pos: "noun",
        frequency: 113
    },
    "father": {
        translations: { es: "padre", fr: "père", de: "Vater", it: "padre", pt: "pai", ja: "父", zh: "父亲", ko: "아버지", ar: "أب", ru: "отец" },
        etymology: { origin: "Old English", originalForm: "fæder", root: "*ph₂tḗr", rootLanguage: "Proto-Indo-European" },
        pos: "noun",
        frequency: 114
    },
    "area": {
        translations: { es: "área", fr: "zone", de: "Bereich", it: "area", pt: "área", ja: "エリア", zh: "地区", ko: "지역", ar: "منطقة", ru: "область" },
        pos: "noun",
        frequency: 115
    },
    "money": {
        translations: { es: "dinero", fr: "argent", de: "Geld", it: "soldi", pt: "dinheiro", ja: "お金", zh: "钱", ko: "돈", ar: "مال", ru: "деньги" },
        pos: "noun",
        frequency: 116
    },
    "story": {
        translations: { es: "historia", fr: "histoire", de: "Geschichte", it: "storia", pt: "história", ja: "物語", zh: "故事", ko: "이야기", ar: "قصة", ru: "история" },
        pos: "noun",
        frequency: 117
    },
    "fact": {
        translations: { es: "hecho", fr: "fait", de: "Tatsache", it: "fatto", pt: "fato", ja: "事実", zh: "事实", ko: "사실", ar: "حقيقة", ru: "факт" },
        pos: "noun",
        frequency: 118
    },
    "month": {
        translations: { es: "mes", fr: "mois", de: "Monat", it: "mese", pt: "mês", ja: "月", zh: "月", ko: "달", ar: "شهر", ru: "месяц" },
        pos: "noun",
        frequency: 119
    },
    "lot": {
        translations: { es: "mucho", fr: "beaucoup", de: "viel", it: "molto", pt: "muito", ja: "たくさん", zh: "很多", ko: "많이", ar: "كثير", ru: "много" },
        pos: "noun",
        frequency: 120
    },
    "right": {
        translations: { es: "derecho", fr: "droit", de: "Recht", it: "diritto", pt: "direito", ja: "権利", zh: "权利", ko: "권리", ar: "حق", ru: "право" },
        pos: "noun",
        frequency: 121
    },
    "study": {
        translations: { es: "estudio", fr: "étude", de: "Studie", it: "studio", pt: "estudo", ja: "研究", zh: "研究", ko: "연구", ar: "دراسة", ru: "исследование" },
        pos: "noun",
        frequency: 122
    },
    "book": {
        translations: { es: "libro", fr: "livre", de: "Buch", it: "libro", pt: "livro", ja: "本", zh: "书", ko: "책", ar: "كتاب", ru: "книга" },
        pos: "noun",
        frequency: 123
    },
    "eye": {
        translations: { es: "ojo", fr: "œil", de: "Auge", it: "occhio", pt: "olho", ja: "目", zh: "眼睛", ko: "눈", ar: "عين", ru: "глаз" },
        pos: "noun",
        frequency: 124
    },
    "job": {
        translations: { es: "trabajo", fr: "travail", de: "Job", it: "lavoro", pt: "trabalho", ja: "仕事", zh: "工作", ko: "직업", ar: "وظيفة", ru: "работа" },
        pos: "noun",
        frequency: 125
    },
    "word": {
        translations: { es: "palabra", fr: "mot", de: "Wort", it: "parola", pt: "palavra", ja: "言葉", zh: "词", ko: "단어", ar: "كلمة", ru: "слово" },
        pos: "noun",
        frequency: 126
    },
    "business": {
        translations: { es: "negocio", fr: "affaires", de: "Geschäft", it: "affari", pt: "negócio", ja: "ビジネス", zh: "业务", ko: "사업", ar: "عمل", ru: "бизнес" },
        pos: "noun",
        frequency: 127
    },
    "issue": {
        translations: { es: "problema", fr: "problème", de: "Problem", it: "problema", pt: "problema", ja: "問題", zh: "问题", ko: "문제", ar: "قضية", ru: "проблема" },
        pos: "noun",
        frequency: 128
    },
    "side": {
        translations: { es: "lado", fr: "côté", de: "Seite", it: "lato", pt: "lado", ja: "側", zh: "边", ko: "측면", ar: "جانب", ru: "сторона" },
        pos: "noun",
        frequency: 129
    },
    "kind": {
        translations: { es: "tipo", fr: "type", de: "Art", it: "tipo", pt: "tipo", ja: "種類", zh: "种类", ko: "종류", ar: "نوع", ru: "вид" },
        pos: "noun",
        frequency: 130
    },
    "head": {
        translations: { es: "cabeza", fr: "tête", de: "Kopf", it: "testa", pt: "cabeça", ja: "頭", zh: "头", ko: "머리", ar: "رأس", ru: "голова" },
        pos: "noun",
        frequency: 131
    },
    "house": {
        translations: { es: "casa", fr: "maison", de: "Haus", it: "casa", pt: "casa", ja: "家", zh: "房子", ko: "집", ar: "منزل", ru: "дом" },
        pos: "noun",
        frequency: 132
    },
    "service": {
        translations: { es: "servicio", fr: "service", de: "Service", it: "servizio", pt: "serviço", ja: "サービス", zh: "服务", ko: "서비스", ar: "خدمة", ru: "сервис" },
        pos: "noun",
        frequency: 133
    },
    "friend": {
        translations: { es: "amigo", fr: "ami", de: "Freund", it: "amico", pt: "amigo", ja: "友達", zh: "朋友", ko: "친구", ar: "صديق", ru: "друг" },
        pos: "noun",
        frequency: 134
    },
    "power": {
        translations: { es: "poder", fr: "pouvoir", de: "Macht", it: "potere", pt: "poder", ja: "力", zh: "力量", ko: "힘", ar: "قوة", ru: "сила" },
        pos: "noun",
        frequency: 135
    },
    "hour": {
        translations: { es: "hora", fr: "heure", de: "Stunde", it: "ora", pt: "hora", ja: "時間", zh: "小时", ko: "시간", ar: "ساعة", ru: "час" },
        pos: "noun",
        frequency: 136
    },
    "game": {
        translations: { es: "juego", fr: "jeu", de: "Spiel", it: "gioco", pt: "jogo", ja: "ゲーム", zh: "游戏", ko: "게임", ar: "لعبة", ru: "игра" },
        pos: "noun",
        frequency: 137
    },
    "line": {
        translations: { es: "línea", fr: "ligne", de: "Linie", it: "linea", pt: "linha", ja: "線", zh: "线", ko: "선", ar: "خط", ru: "линия" },
        pos: "noun",
        frequency: 138
    },
    "end": {
        translations: { es: "fin", fr: "fin", de: "Ende", it: "fine", pt: "fim", ja: "終わり", zh: "结束", ko: "끝", ar: "نهاية", ru: "конец" },
        pos: "noun",
        frequency: 139
    },
    "member": {
        translations: { es: "miembro", fr: "membre", de: "Mitglied", it: "membro", pt: "membro", ja: "メンバー", zh: "成员", ko: "회원", ar: "عضو", ru: "член" },
        pos: "noun",
        frequency: 140
    },
    "law": {
        translations: { es: "ley", fr: "loi", de: "Gesetz", it: "legge", pt: "lei", ja: "法律", zh: "法律", ko: "법", ar: "قانون", ru: "закон" },
        pos: "noun",
        frequency: 141
    },
    "car": {
        translations: { es: "coche", fr: "voiture", de: "Auto", it: "macchina", pt: "carro", ja: "車", zh: "汽车", ko: "자동차", ar: "سيارة", ru: "машина" },
        pos: "noun",
        frequency: 142
    },
    "city": {
        translations: { es: "ciudad", fr: "ville", de: "Stadt", it: "città", pt: "cidade", ja: "都市", zh: "城市", ko: "도시", ar: "مدينة", ru: "город" },
        pos: "noun",
        frequency: 143
    },
    "name": {
        translations: { es: "nombre", fr: "nom", de: "Name", it: "nome", pt: "nome", ja: "名前", zh: "名字", ko: "이름", ar: "اسم", ru: "имя" },
        pos: "noun",
        frequency: 144
    },
    "president": {
        translations: { es: "presidente", fr: "président", de: "Präsident", it: "presidente", pt: "presidente", ja: "大統領", zh: "总统", ko: "대통령", ar: "رئيس", ru: "президент" },
        pos: "noun",
        frequency: 145
    },
    "team": {
        translations: { es: "equipo", fr: "équipe", de: "Team", it: "squadra", pt: "equipe", ja: "チーム", zh: "团队", ko: "팀", ar: "فريق", ru: "команда" },
        pos: "noun",
        frequency: 146
    },
    "minute": {
        translations: { es: "minuto", fr: "minute", de: "Minute", it: "minuto", pt: "minuto", ja: "分", zh: "分钟", ko: "분", ar: "دقيقة", ru: "минута" },
        pos: "noun",
        frequency: 147
    },
    "idea": {
        translations: { es: "idea", fr: "idée", de: "Idee", it: "idea", pt: "ideia", ja: "アイデア", zh: "想法", ko: "아이디어", ar: "فكرة", ru: "идея" },
        pos: "noun",
        frequency: 148
    },
    "kid": {
        translations: { es: "niño", fr: "enfant", de: "Kind", it: "bambino", pt: "criança", ja: "子供", zh: "孩子", ko: "아이", ar: "طفل", ru: "ребёнок" },
        pos: "noun",
        frequency: 149
    },
    "body": {
        translations: { es: "cuerpo", fr: "corps", de: "Körper", it: "corpo", pt: "corpo", ja: "体", zh: "身体", ko: "몸", ar: "جسم", ru: "тело" },
        pos: "noun",
        frequency: 150
    },

    // Common Adjectives
    "good": {
        translations: { es: "bueno", fr: "bon", de: "gut", it: "buono", pt: "bom", ja: "良い", zh: "好", ko: "좋은", ar: "جيد", ru: "хороший" },
        pos: "adjective",
        frequency: 151
    },
    "new": {
        translations: { es: "nuevo", fr: "nouveau", de: "neu", it: "nuovo", pt: "novo", ja: "新しい", zh: "新", ko: "새로운", ar: "جديد", ru: "новый" },
        pos: "adjective",
        frequency: 152
    },
    "first": {
        translations: { es: "primero", fr: "premier", de: "erst", it: "primo", pt: "primeiro", ja: "最初", zh: "第一", ko: "첫 번째", ar: "أول", ru: "первый" },
        pos: "adjective",
        frequency: 153
    },
    "last": {
        translations: { es: "último", fr: "dernier", de: "letzt", it: "ultimo", pt: "último", ja: "最後", zh: "最后", ko: "마지막", ar: "آخر", ru: "последний" },
        pos: "adjective",
        frequency: 154
    },
    "long": {
        translations: { es: "largo", fr: "long", de: "lang", it: "lungo", pt: "longo", ja: "長い", zh: "长", ko: "긴", ar: "طويل", ru: "длинный" },
        pos: "adjective",
        frequency: 155
    },
    "great": {
        translations: { es: "genial", fr: "génial", de: "großartig", it: "fantastico", pt: "ótimo", ja: "素晴らしい", zh: "很棒", ko: "훌륭한", ar: "عظيم", ru: "отличный" },
        pos: "adjective",
        frequency: 156
    },
    "little": {
        translations: { es: "pequeño", fr: "petit", de: "klein", it: "piccolo", pt: "pequeno", ja: "小さい", zh: "小", ko: "작은", ar: "صغير", ru: "маленький" },
        pos: "adjective",
        frequency: 157
    },
    "own": {
        translations: { es: "propio", fr: "propre", de: "eigen", it: "proprio", pt: "próprio", ja: "自分の", zh: "自己的", ko: "자신의", ar: "خاص", ru: "собственный" },
        pos: "adjective",
        frequency: 158
    },
    "other": {
        translations: { es: "otro", fr: "autre", de: "ander", it: "altro", pt: "outro", ja: "他の", zh: "其他", ko: "다른", ar: "آخر", ru: "другой" },
        pos: "adjective",
        frequency: 159
    },
    "old": {
        translations: { es: "viejo", fr: "vieux", de: "alt", it: "vecchio", pt: "velho", ja: "古い", zh: "老", ko: "늙은", ar: "قديم", ru: "старый" },
        pos: "adjective",
        frequency: 160
    },
    // "right" as adjective omitted - noun form exists, use "correct" instead
    "correct": {
        translations: { es: "correcto", fr: "correct", de: "richtig", it: "corretto", pt: "correto", ja: "正しい", zh: "正确", ko: "올바른", ar: "صحيح", ru: "правильный" },
        pos: "adjective",
        frequency: 161
    },
    "big": {
        translations: { es: "grande", fr: "grand", de: "groß", it: "grande", pt: "grande", ja: "大きい", zh: "大", ko: "큰", ar: "كبير", ru: "большой" },
        pos: "adjective",
        frequency: 162
    },
    "high": {
        translations: { es: "alto", fr: "haut", de: "hoch", it: "alto", pt: "alto", ja: "高い", zh: "高", ko: "높은", ar: "عالي", ru: "высокий" },
        pos: "adjective",
        frequency: 163
    },
    "different": {
        translations: { es: "diferente", fr: "différent", de: "verschieden", it: "diverso", pt: "diferente", ja: "違う", zh: "不同", ko: "다른", ar: "مختلف", ru: "разный" },
        pos: "adjective",
        frequency: 164
    },
    "small": {
        translations: { es: "pequeño", fr: "petit", de: "klein", it: "piccolo", pt: "pequeno", ja: "小さい", zh: "小", ko: "작은", ar: "صغير", ru: "маленький" },
        pos: "adjective",
        frequency: 165
    },
    "large": {
        translations: { es: "grande", fr: "grand", de: "groß", it: "grande", pt: "grande", ja: "大きい", zh: "大", ko: "큰", ar: "كبير", ru: "большой" },
        pos: "adjective",
        frequency: 166
    },
    "important": {
        translations: { es: "importante", fr: "important", de: "wichtig", it: "importante", pt: "importante", ja: "重要な", zh: "重要", ko: "중요한", ar: "مهم", ru: "важный" },
        pos: "adjective",
        frequency: 167
    },
    "young": {
        translations: { es: "joven", fr: "jeune", de: "jung", it: "giovane", pt: "jovem", ja: "若い", zh: "年轻", ko: "젊은", ar: "شاب", ru: "молодой" },
        pos: "adjective",
        frequency: 168
    },
    "national": {
        translations: { es: "nacional", fr: "national", de: "national", it: "nazionale", pt: "nacional", ja: "国家の", zh: "国家的", ko: "국가의", ar: "وطني", ru: "национальный" },
        pos: "adjective",
        frequency: 169
    },
    "bad": {
        translations: { es: "malo", fr: "mauvais", de: "schlecht", it: "cattivo", pt: "mau", ja: "悪い", zh: "坏", ko: "나쁜", ar: "سيء", ru: "плохой" },
        pos: "adjective",
        frequency: 170
    },
    "black": {
        translations: { es: "negro", fr: "noir", de: "schwarz", it: "nero", pt: "preto", ja: "黒い", zh: "黑", ko: "검은", ar: "أسود", ru: "чёрный" },
        pos: "adjective",
        frequency: 171
    },
    "white": {
        translations: { es: "blanco", fr: "blanc", de: "weiß", it: "bianco", pt: "branco", ja: "白い", zh: "白", ko: "흰", ar: "أبيض", ru: "белый" },
        pos: "adjective",
        frequency: 172
    },
    "red": {
        translations: { es: "rojo", fr: "rouge", de: "rot", it: "rosso", pt: "vermelho", ja: "赤い", zh: "红", ko: "빨간", ar: "أحمر", ru: "красный" },
        pos: "adjective",
        frequency: 173
    },
    "blue": {
        translations: { es: "azul", fr: "bleu", de: "blau", it: "blu", pt: "azul", ja: "青い", zh: "蓝", ko: "파란", ar: "أزرق", ru: "синий" },
        pos: "adjective",
        frequency: 174
    },
    "green": {
        translations: { es: "verde", fr: "vert", de: "grün", it: "verde", pt: "verde", ja: "緑", zh: "绿", ko: "녹색", ar: "أخضر", ru: "зелёный" },
        pos: "adjective",
        frequency: 175
    },
    "beautiful": {
        translations: { es: "hermoso", fr: "beau", de: "schön", it: "bello", pt: "bonito", ja: "美しい", zh: "美丽", ko: "아름다운", ar: "جميل", ru: "красивый" },
        pos: "adjective",
        frequency: 176
    },
    "happy": {
        translations: { es: "feliz", fr: "heureux", de: "glücklich", it: "felice", pt: "feliz", ja: "幸せな", zh: "快乐", ko: "행복한", ar: "سعيد", ru: "счастливый" },
        pos: "adjective",
        frequency: 177
    },
    "sad": {
        translations: { es: "triste", fr: "triste", de: "traurig", it: "triste", pt: "triste", ja: "悲しい", zh: "悲伤", ko: "슬픈", ar: "حزين", ru: "грустный" },
        pos: "adjective",
        frequency: 178
    },
    "easy": {
        translations: { es: "fácil", fr: "facile", de: "einfach", it: "facile", pt: "fácil", ja: "簡単な", zh: "容易", ko: "쉬운", ar: "سهل", ru: "лёгкий" },
        pos: "adjective",
        frequency: 179
    },
    "hard": {
        translations: { es: "difícil", fr: "difficile", de: "schwierig", it: "difficile", pt: "difícil", ja: "難しい", zh: "困难", ko: "어려운", ar: "صعب", ru: "трудный" },
        pos: "adjective",
        frequency: 180
    },
    "fast": {
        translations: { es: "rápido", fr: "rapide", de: "schnell", it: "veloce", pt: "rápido", ja: "速い", zh: "快", ko: "빠른", ar: "سريع", ru: "быстрый" },
        pos: "adjective",
        frequency: 181
    },
    "slow": {
        translations: { es: "lento", fr: "lent", de: "langsam", it: "lento", pt: "lento", ja: "遅い", zh: "慢", ko: "느린", ar: "بطيء", ru: "медленный" },
        pos: "adjective",
        frequency: 182
    },
    "hot": {
        translations: { es: "caliente", fr: "chaud", de: "heiß", it: "caldo", pt: "quente", ja: "熱い", zh: "热", ko: "뜨거운", ar: "ساخن", ru: "горячий" },
        pos: "adjective",
        frequency: 183
    },
    "cold": {
        translations: { es: "frío", fr: "froid", de: "kalt", it: "freddo", pt: "frio", ja: "冷たい", zh: "冷", ko: "차가운", ar: "بارد", ru: "холодный" },
        pos: "adjective",
        frequency: 184
    },
    "free": {
        translations: { es: "gratis", fr: "gratuit", de: "kostenlos", it: "gratuito", pt: "grátis", ja: "無料", zh: "免费", ko: "무료", ar: "مجاني", ru: "бесплатный" },
        pos: "adjective",
        frequency: 185
    },

    // Prepositions & Conjunctions
    "and": {
        translations: { es: "y", fr: "et", de: "und", it: "e", pt: "e", ja: "と", zh: "和", ko: "그리고", ar: "و", ru: "и" },
        pos: "conjunction",
        frequency: 186
    },
    "or": {
        translations: { es: "o", fr: "ou", de: "oder", it: "o", pt: "ou", ja: "または", zh: "或", ko: "또는", ar: "أو", ru: "или" },
        pos: "conjunction",
        frequency: 187
    },
    "but": {
        translations: { es: "pero", fr: "mais", de: "aber", it: "ma", pt: "mas", ja: "しかし", zh: "但是", ko: "하지만", ar: "لكن", ru: "но" },
        pos: "conjunction",
        frequency: 188
    },
    "if": {
        translations: { es: "si", fr: "si", de: "wenn", it: "se", pt: "se", ja: "もし", zh: "如果", ko: "만약", ar: "إذا", ru: "если" },
        pos: "conjunction",
        frequency: 189
    },
    "because": {
        translations: { es: "porque", fr: "parce que", de: "weil", it: "perché", pt: "porque", ja: "なぜなら", zh: "因为", ko: "왜냐하면", ar: "لأن", ru: "потому что" },
        pos: "conjunction",
        frequency: 190
    },
    "when": {
        translations: { es: "cuando", fr: "quand", de: "wenn", it: "quando", pt: "quando", ja: "いつ", zh: "当", ko: "언제", ar: "عندما", ru: "когда" },
        pos: "adverb",
        frequency: 191
    },
    "where": {
        translations: { es: "donde", fr: "où", de: "wo", it: "dove", pt: "onde", ja: "どこ", zh: "哪里", ko: "어디", ar: "أين", ru: "где" },
        pos: "adverb",
        frequency: 192
    },
    "how": {
        translations: { es: "cómo", fr: "comment", de: "wie", it: "come", pt: "como", ja: "どのように", zh: "怎么", ko: "어떻게", ar: "كيف", ru: "как" },
        pos: "adverb",
        frequency: 193
    },
    "what": {
        translations: { es: "qué", fr: "quoi", de: "was", it: "cosa", pt: "o que", ja: "何", zh: "什么", ko: "무엇", ar: "ماذا", ru: "что" },
        pos: "pronoun",
        frequency: 194
    },
    "why": {
        translations: { es: "por qué", fr: "pourquoi", de: "warum", it: "perché", pt: "por que", ja: "なぜ", zh: "为什么", ko: "왜", ar: "لماذا", ru: "почему" },
        pos: "adverb",
        frequency: 195
    },
    "who": {
        translations: { es: "quién", fr: "qui", de: "wer", it: "chi", pt: "quem", ja: "誰", zh: "谁", ko: "누구", ar: "من", ru: "кто" },
        pos: "pronoun",
        frequency: 196
    },
    "which": {
        translations: { es: "cuál", fr: "quel", de: "welch", it: "quale", pt: "qual", ja: "どれ", zh: "哪个", ko: "어느", ar: "أي", ru: "который" },
        pos: "pronoun",
        frequency: 197
    },
    "in": {
        translations: { es: "en", fr: "dans", de: "in", it: "in", pt: "em", ja: "で", zh: "在", ko: "에", ar: "في", ru: "в" },
        pos: "preposition",
        frequency: 198
    },
    "on": {
        translations: { es: "en", fr: "sur", de: "auf", it: "su", pt: "em", ja: "の上に", zh: "在上", ko: "위에", ar: "على", ru: "на" },
        pos: "preposition",
        frequency: 199
    },
    "at": {
        translations: { es: "en", fr: "à", de: "bei", it: "a", pt: "em", ja: "で", zh: "在", ko: "에서", ar: "في", ru: "у" },
        pos: "preposition",
        frequency: 200
    },
    "to": {
        translations: { es: "a", fr: "à", de: "zu", it: "a", pt: "para", ja: "へ", zh: "到", ko: "으로", ar: "إلى", ru: "к" },
        pos: "preposition",
        frequency: 201
    },
    "for": {
        translations: { es: "para", fr: "pour", de: "für", it: "per", pt: "para", ja: "のために", zh: "为了", ko: "위해", ar: "من أجل", ru: "для" },
        pos: "preposition",
        frequency: 202
    },
    "with": {
        translations: { es: "con", fr: "avec", de: "mit", it: "con", pt: "com", ja: "と一緒に", zh: "和", ko: "와 함께", ar: "مع", ru: "с" },
        pos: "preposition",
        frequency: 203
    },
    "from": {
        translations: { es: "de", fr: "de", de: "von", it: "da", pt: "de", ja: "から", zh: "从", ko: "에서", ar: "من", ru: "от" },
        pos: "preposition",
        frequency: 204
    },
    "by": {
        translations: { es: "por", fr: "par", de: "von", it: "da", pt: "por", ja: "によって", zh: "被", ko: "에 의해", ar: "بواسطة", ru: "от" },
        pos: "preposition",
        frequency: 205
    },
    "about": {
        translations: { es: "sobre", fr: "sur", de: "über", it: "su", pt: "sobre", ja: "について", zh: "关于", ko: "에 대해", ar: "عن", ru: "о" },
        pos: "preposition",
        frequency: 206
    },

    // Numbers
    "one": {
        translations: { es: "uno", fr: "un", de: "eins", it: "uno", pt: "um", ja: "一", zh: "一", ko: "하나", ar: "واحد", ru: "один" },
        pos: "number",
        frequency: 207
    },
    "two": {
        translations: { es: "dos", fr: "deux", de: "zwei", it: "due", pt: "dois", ja: "二", zh: "二", ko: "둘", ar: "اثنان", ru: "два" },
        pos: "number",
        frequency: 208
    },
    "three": {
        translations: { es: "tres", fr: "trois", de: "drei", it: "tre", pt: "três", ja: "三", zh: "三", ko: "셋", ar: "ثلاثة", ru: "три" },
        pos: "number",
        frequency: 209
    },
    "four": {
        translations: { es: "cuatro", fr: "quatre", de: "vier", it: "quattro", pt: "quatro", ja: "四", zh: "四", ko: "넷", ar: "أربعة", ru: "четыре" },
        pos: "number",
        frequency: 210
    },
    "five": {
        translations: { es: "cinco", fr: "cinq", de: "fünf", it: "cinque", pt: "cinco", ja: "五", zh: "五", ko: "다섯", ar: "خمسة", ru: "пять" },
        pos: "number",
        frequency: 211
    },
    "ten": {
        translations: { es: "diez", fr: "dix", de: "zehn", it: "dieci", pt: "dez", ja: "十", zh: "十", ko: "열", ar: "عشرة", ru: "десять" },
        pos: "number",
        frequency: 212
    },
    "hundred": {
        translations: { es: "cien", fr: "cent", de: "hundert", it: "cento", pt: "cem", ja: "百", zh: "百", ko: "백", ar: "مائة", ru: "сто" },
        pos: "number",
        frequency: 213
    },
    "thousand": {
        translations: { es: "mil", fr: "mille", de: "tausend", it: "mille", pt: "mil", ja: "千", zh: "千", ko: "천", ar: "ألف", ru: "тысяча" },
        pos: "number",
        frequency: 214
    },

    // Time expressions
    "today": {
        translations: { es: "hoy", fr: "aujourd'hui", de: "heute", it: "oggi", pt: "hoje", ja: "今日", zh: "今天", ko: "오늘", ar: "اليوم", ru: "сегодня" },
        pos: "adverb",
        frequency: 215
    },
    "tomorrow": {
        translations: { es: "mañana", fr: "demain", de: "morgen", it: "domani", pt: "amanhã", ja: "明日", zh: "明天", ko: "내일", ar: "غدا", ru: "завтра" },
        pos: "adverb",
        frequency: 216
    },
    "yesterday": {
        translations: { es: "ayer", fr: "hier", de: "gestern", it: "ieri", pt: "ontem", ja: "昨日", zh: "昨天", ko: "어제", ar: "أمس", ru: "вчера" },
        pos: "adverb",
        frequency: 217
    },
    "now": {
        translations: { es: "ahora", fr: "maintenant", de: "jetzt", it: "adesso", pt: "agora", ja: "今", zh: "现在", ko: "지금", ar: "الآن", ru: "сейчас" },
        pos: "adverb",
        frequency: 218
    },
    "always": {
        translations: { es: "siempre", fr: "toujours", de: "immer", it: "sempre", pt: "sempre", ja: "いつも", zh: "总是", ko: "항상", ar: "دائما", ru: "всегда" },
        pos: "adverb",
        frequency: 219
    },
    "never": {
        translations: { es: "nunca", fr: "jamais", de: "nie", it: "mai", pt: "nunca", ja: "決して", zh: "从不", ko: "결코", ar: "أبدا", ru: "никогда" },
        pos: "adverb",
        frequency: 220
    },
    "sometimes": {
        translations: { es: "a veces", fr: "parfois", de: "manchmal", it: "a volte", pt: "às vezes", ja: "時々", zh: "有时", ko: "때때로", ar: "أحيانا", ru: "иногда" },
        pos: "adverb",
        frequency: 221
    },

    // Common expressions
    "sorry": {
        translations: { es: "lo siento", fr: "désolé", de: "Entschuldigung", it: "scusa", pt: "desculpe", ja: "ごめんなさい", zh: "对不起", ko: "미안합니다", ar: "آسف", ru: "извините" },
        pos: "interjection",
        frequency: 222
    },
    "excuse me": {
        translations: { es: "disculpe", fr: "excusez-moi", de: "Entschuldigung", it: "scusi", pt: "com licença", ja: "すみません", zh: "请原谅", ko: "실례합니다", ar: "عفوا", ru: "извините" },
        pos: "phrase",
        frequency: 223
    },
    "welcome": {
        translations: { es: "bienvenido", fr: "bienvenu", de: "willkommen", it: "benvenuto", pt: "bem-vindo", ja: "ようこそ", zh: "欢迎", ko: "환영합니다", ar: "أهلا", ru: "добро пожаловать" },
        pos: "interjection",
        frequency: 224
    },
    "good morning": {
        translations: { es: "buenos días", fr: "bonjour", de: "guten Morgen", it: "buongiorno", pt: "bom dia", ja: "おはようございます", zh: "早上好", ko: "좋은 아침", ar: "صباح الخير", ru: "доброе утро" },
        pos: "phrase",
        frequency: 225
    },
    "good night": {
        translations: { es: "buenas noches", fr: "bonne nuit", de: "gute Nacht", it: "buonanotte", pt: "boa noite", ja: "おやすみなさい", zh: "晚安", ko: "좋은 밤", ar: "تصبح على خير", ru: "спокойной ночи" },
        pos: "phrase",
        frequency: 226
    },
    "how are you": {
        translations: { es: "¿cómo estás?", fr: "comment allez-vous?", de: "wie geht es Ihnen?", it: "come stai?", pt: "como vai?", ja: "お元気ですか", zh: "你好吗", ko: "어떻게 지내세요?", ar: "كيف حالك؟", ru: "как дела?" },
        pos: "phrase",
        frequency: 227
    },
    "i love you": {
        translations: { es: "te quiero", fr: "je t'aime", de: "ich liebe dich", it: "ti amo", pt: "eu te amo", ja: "愛してる", zh: "我爱你", ko: "사랑해요", ar: "أحبك", ru: "я люблю тебя" },
        pos: "phrase",
        frequency: 228
    },
};

// =============================================================================
// DICTIONARY LOOKUP FUNCTIONS
// =============================================================================

/**
 * Look up a word in the core dictionary
 */
export function lookupWord(word: string): DictionaryEntry | null {
    const normalized = word.toLowerCase().trim();
    return CORE_DICTIONARY[normalized] || null;
}

/**
 * Translate a single word using the dictionary
 */
export function translateWord(word: string, targetLang: string): TranslationResult | null {
    const entry = lookupWord(word);

    if (!entry || !entry.translations[targetLang]) {
        return null;
    }

    return {
        original: word,
        translated: entry.translations[targetLang],
        source: 'dictionary',
        etymology: entry.etymology,
        confidence: 1.0, // Dictionary translations are 100% confident
    };
}

/**
 * Translate multiple words, returning which ones were found
 */
export function translateWords(
    words: string[],
    targetLang: string
): { translated: TranslationResult[]; notFound: string[] } {
    const translated: TranslationResult[] = [];
    const notFound: string[] = [];

    for (const word of words) {
        const result = translateWord(word, targetLang);
        if (result) {
            translated.push(result);
        } else {
            notFound.push(word);
        }
    }

    return { translated, notFound };
}

/**
 * Check if a language pair is supported for dictionary lookup
 */
export function isLanguagePairSupported(sourceLang: string, targetLang: string): boolean {
    // All words in the dictionary have translations from English
    if (sourceLang === 'en' || sourceLang === 'auto') {
        // Check if target language exists in any entry
        const sampleEntry = CORE_DICTIONARY['hello'];
        return sampleEntry?.translations[targetLang] !== undefined;
    }
    return false;
}

/**
 * Get all supported target languages
 */
export function getSupportedLanguages(): string[] {
    const sampleEntry = CORE_DICTIONARY['hello'];
    return sampleEntry ? Object.keys(sampleEntry.translations) : [];
}

/**
 * Get etymology data for a word
 */
export function getEtymology(word: string): EtymologyData | null {
    const entry = lookupWord(word);
    return entry?.etymology || null;
}

/**
 * Search dictionary for words matching a pattern
 */
export function searchDictionary(
    query: string,
    options: { limit?: number; includeTranslations?: boolean } = {}
): Array<{ word: string; entry: DictionaryEntry }> {
    const { limit = 10, includeTranslations = false } = options;
    const results: Array<{ word: string; entry: DictionaryEntry }> = [];
    const normalizedQuery = query.toLowerCase().trim();

    for (const [word, entry] of Object.entries(CORE_DICTIONARY)) {
        if (results.length >= limit) break;

        // Match word
        if (word.includes(normalizedQuery)) {
            results.push({ word, entry });
            continue;
        }

        // Optionally match in translations
        if (includeTranslations) {
            for (const translation of Object.values(entry.translations)) {
                if (translation.toLowerCase().includes(normalizedQuery)) {
                    results.push({ word, entry });
                    break;
                }
            }
        }
    }

    return results;
}

/**
 * Get dictionary statistics
 */
export function getDictionaryStats(): {
    wordCount: number;
    languagesSupported: string[];
    categoryCounts: Record<string, number>;
} {
    const categoryCounts: Record<string, number> = {};

    for (const entry of Object.values(CORE_DICTIONARY)) {
        const pos = entry.pos || 'unknown';
        categoryCounts[pos] = (categoryCounts[pos] || 0) + 1;
    }

    return {
        wordCount: Object.keys(CORE_DICTIONARY).length,
        languagesSupported: getSupportedLanguages(),
        categoryCounts,
    };
}

// Export the core dictionary for direct access if needed
export { CORE_DICTIONARY };
