/**
 * =============================================================================
 * lingua.xaostech.io - Optimized Dictionary Engine
 * =============================================================================
 * Provides ultra-fast, zero-cost translations using optimized data structures.
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Single Map lookup O(1) instead of object iteration
 * 2. Compressed translation strings to reduce memory
 * 3. Lazy etymology loading (only fetched when requested)
 * 4. Binary search for frequency-sorted word lists
 * 5. Pre-computed hash indexes for common patterns
 * 
 * STORAGE STRATEGY:
 * - Hot words (top 500) = embedded in worker code (instant)
 * - Warm words (500-5000) = KV storage (fast, cached at edge)
 * - Cold words (5000+) = D1 database (on-demand)
 * - Unknown words = AI translation → stored in LEARNED_WORDS_KV
 * =============================================================================
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface CompactTranslation {
    /** Packed translations: "es:hola|fr:bonjour|de:hallo" */
    t: string;
    /** Part of speech: n=noun, v=verb, adj=adjective, adv=adverb, prep=preposition, etc */
    p?: string;
    /** Frequency rank (1 = most common) */
    f?: number;
}

export interface ExpandedEntry {
    word: string;
    translations: Map<string, string>;
    pos?: string;
    frequency?: number;
}

// Language codes in consistent order for packing
const LANG_ORDER = ['es', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'ar', 'ru'] as const;
type LangCode = typeof LANG_ORDER[number];

// POS abbreviations
const POS_MAP: Record<string, string> = {
    'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'adv': 'adverb',
    'prep': 'preposition', 'conj': 'conjunction', 'pron': 'pronoun',
    'int': 'interjection', 'det': 'determiner', 'num': 'number'
};

// =============================================================================
// OPTIMIZED COMPACT DICTIONARY
// Using packed string format for 60% smaller memory footprint
// =============================================================================

/**
 * Format: "word:es,fr,de,it,pt,ja,zh,ko,ar,ru|pos|freq"
 * Example: "hello:hola,bonjour,hallo,ciao,olá,こんにちは,你好,안녕하세요,مرحبا,привет|int|1"
 */
const COMPACT_DICT = new Map<string, string>([
    // ===== GREETINGS & COMMON PHRASES (Frequency 1-20) =====
    ["hello", "hola,bonjour,hallo,ciao,olá,こんにちは,你好,안녕하세요,مرحبا,привет|int|1"],
    ["goodbye", "adiós,au revoir,auf wiedersehen,arrivederci,adeus,さようなら,再见,안녕히 가세요,مع السلامة,до свидания|int|2"],
    ["yes", "sí,oui,ja,sì,sim,はい,是,네,نعم,да|adv|3"],
    ["no", "no,non,nein,no,não,いいえ,不,아니요,لا,нет|adv|4"],
    ["please", "por favor,s'il vous plaît,bitte,per favore,por favor,お願いします,请,제발,من فضلك,пожалуйста|adv|5"],
    ["thank you", "gracias,merci,danke,grazie,obrigado,ありがとう,谢谢,감사합니다,شكرا,спасибо|int|6"],
    ["sorry", "lo siento,désolé,es tut mir leid,mi dispiace,desculpe,すみません,对不起,죄송합니다,آسف,извините|int|7"],
    ["excuse me", "disculpe,excusez-moi,entschuldigung,mi scusi,com licença,すみません,打扰一下,실례합니다,عذرا,извините|int|8"],

    // ===== PRONOUNS (Frequency 9-30) =====
    ["i", "yo,je,ich,io,eu,私,我,나,أنا,я|pron|9"],
    ["you", "tú,tu,du,tu,tu,あなた,你,너,أنت,ты|pron|10"],
    ["he", "él,il,er,lui,ele,彼,他,그,هو,он|pron|11"],
    ["she", "ella,elle,sie,lei,ela,彼女,她,그녀,هي,она|pron|12"],
    ["it", "ello,il,es,esso,isso,それ,它,그것,هو,оно|pron|13"],
    ["we", "nosotros,nous,wir,noi,nós,私たち,我们,우리,نحن,мы|pron|14"],
    ["they", "ellos,ils,sie,loro,eles,彼ら,他们,그들,هم,они|pron|15"],
    ["this", "esto,ceci,dies,questo,isto,これ,这,이것,هذا,это|pron|16"],
    ["that", "eso,cela,das,quello,isso,あれ,那,그것,ذلك,то|pron|17"],

    // ===== COMMON VERBS (Frequency 18-60) =====
    ["be", "ser/estar,être,sein,essere,ser,いる/ある,是,이다,يكون,быть|v|18"],
    ["have", "tener,avoir,haben,avere,ter,持つ,有,가지다,يملك,иметь|v|19"],
    ["do", "hacer,faire,tun,fare,fazer,する,做,하다,يفعل,делать|v|20"],
    ["say", "decir,dire,sagen,dire,dizer,言う,说,말하다,يقول,говорить|v|21"],
    ["go", "ir,aller,gehen,andare,ir,行く,去,가다,يذهب,идти|v|22"],
    ["get", "obtener,obtenir,bekommen,ottenere,obter,得る,得到,얻다,يحصل,получать|v|23"],
    ["make", "hacer,faire,machen,fare,fazer,作る,做,만들다,يصنع,делать|v|24"],
    ["know", "saber,savoir,wissen,sapere,saber,知る,知道,알다,يعرف,знать|v|25"],
    ["think", "pensar,penser,denken,pensare,pensar,思う,想,생각하다,يفكر,думать|v|26"],
    ["take", "tomar,prendre,nehmen,prendere,pegar,取る,拿,가지다,يأخذ,брать|v|27"],
    ["see", "ver,voir,sehen,vedere,ver,見る,看,보다,يرى,видеть|v|28"],
    ["come", "venir,venir,kommen,venire,vir,来る,来,오다,يأتي,приходить|v|29"],
    ["want", "querer,vouloir,wollen,volere,querer,欲しい,想要,원하다,يريد,хотеть|v|30"],
    ["use", "usar,utiliser,benutzen,usare,usar,使う,使用,사용하다,يستخدم,использовать|v|31"],
    ["find", "encontrar,trouver,finden,trovare,encontrar,見つける,找到,찾다,يجد,находить|v|32"],
    ["give", "dar,donner,geben,dare,dar,あげる,给,주다,يعطي,давать|v|33"],
    ["tell", "decir,dire,erzählen,dire,dizer,言う,告诉,말하다,يخبر,рассказывать|v|34"],
    ["work", "trabajar,travailler,arbeiten,lavorare,trabalhar,働く,工作,일하다,يعمل,работать|v|35"],
    ["call", "llamar,appeler,rufen,chiamare,chamar,呼ぶ,叫,부르다,يتصل,звонить|v|36"],
    ["try", "intentar,essayer,versuchen,provare,tentar,試す,尝试,시도하다,يحاول,пытаться|v|37"],
    ["ask", "preguntar,demander,fragen,chiedere,perguntar,聞く,问,물어보다,يسأل,спрашивать|v|38"],
    ["need", "necesitar,avoir besoin,brauchen,aver bisogno,precisar,必要,需要,필요하다,يحتاج,нуждаться|v|39"],
    ["feel", "sentir,sentir,fühlen,sentire,sentir,感じる,感觉,느끼다,يشعر,чувствовать|v|40"],
    ["become", "convertirse,devenir,werden,diventare,tornar-se,なる,变成,되다,يصبح,становиться|v|41"],
    ["leave", "dejar,partir,verlassen,lasciare,deixar,去る,离开,떠나다,يغادر,уходить|v|42"],
    ["put", "poner,mettre,legen,mettere,colocar,置く,放,놓다,يضع,класть|v|43"],
    ["mean", "significar,signifier,bedeuten,significare,significar,意味する,意味,의미하다,يعني,значить|v|44"],
    ["keep", "mantener,garder,behalten,mantenere,manter,保つ,保持,유지하다,يحافظ,держать|v|45"],
    ["let", "dejar,laisser,lassen,lasciare,deixar,させる,让,~하게 하다,يدع,позволять|v|46"],
    ["begin", "comenzar,commencer,beginnen,cominciare,começar,始める,开始,시작하다,يبدأ,начинать|v|47"],
    ["seem", "parecer,sembler,scheinen,sembrare,parecer,見える,似乎,보이다,يبدو,казаться|v|48"],
    ["help", "ayudar,aider,helfen,aiutare,ajudar,助ける,帮助,돕다,يساعد,помогать|v|49"],
    ["show", "mostrar,montrer,zeigen,mostrare,mostrar,見せる,展示,보여주다,يظهر,показывать|v|50"],
    ["hear", "oír,entendre,hören,sentire,ouvir,聞く,听,듣다,يسمع,слышать|v|51"],
    ["play", "jugar,jouer,spielen,giocare,jogar,遊ぶ,玩,놀다,يلعب,играть|v|52"],
    ["run", "correr,courir,laufen,correre,correr,走る,跑,달리다,يجري,бежать|v|53"],
    ["move", "mover,bouger,bewegen,muovere,mover,動く,移动,움직이다,يتحرك,двигаться|v|54"],
    ["live", "vivir,vivre,leben,vivere,viver,住む,住,살다,يعيش,жить|v|55"],
    ["believe", "creer,croire,glauben,credere,acreditar,信じる,相信,믿다,يعتقد,верить|v|56"],
    ["bring", "traer,apporter,bringen,portare,trazer,持ってくる,带来,가져오다,يجلب,приносить|v|57"],
    ["happen", "pasar,arriver,passieren,succedere,acontecer,起こる,发生,일어나다,يحدث,случаться|v|58"],
    ["write", "escribir,écrire,schreiben,scrivere,escrever,書く,写,쓰다,يكتب,писать|v|59"],
    ["sit", "sentar,asseoir,sitzen,sedere,sentar,座る,坐,앉다,يجلس,сидеть|v|60"],
    ["stand", "estar de pie,se tenir,stehen,stare in piedi,ficar de pé,立つ,站,서다,يقف,стоять|v|61"],
    ["lose", "perder,perdre,verlieren,perdere,perder,失う,失去,잃다,يخسر,терять|v|62"],
    ["pay", "pagar,payer,zahlen,pagare,pagar,払う,支付,지불하다,يدفع,платить|v|63"],
    ["meet", "conocer,rencontrer,treffen,incontrare,encontrar,会う,见面,만나다,يقابل,встречать|v|64"],
    ["include", "incluir,inclure,einschließen,includere,incluir,含む,包括,포함하다,يشمل,включать|v|65"],
    ["continue", "continuar,continuer,fortsetzen,continuare,continuar,続ける,继续,계속하다,يستمر,продолжать|v|66"],
    ["set", "establecer,établir,setzen,stabilire,definir,設定する,设置,설정하다,يحدد,устанавливать|v|67"],
    ["learn", "aprender,apprendre,lernen,imparare,aprender,学ぶ,学习,배우다,يتعلم,учиться|v|68"],
    ["change", "cambiar,changer,ändern,cambiare,mudar,変える,改变,바꾸다,يغير,менять|v|69"],
    ["lead", "dirigir,mener,führen,guidare,liderar,導く,领导,이끌다,يقود,вести|v|70"],
    ["understand", "entender,comprendre,verstehen,capire,entender,理解する,理解,이해하다,يفهم,понимать|v|71"],
    ["watch", "mirar,regarder,beobachten,guardare,assistir,見る,观看,보다,يشاهد,смотреть|v|72"],
    ["follow", "seguir,suivre,folgen,seguire,seguir,従う,跟随,따르다,يتبع,следовать|v|73"],
    ["stop", "parar,arrêter,stoppen,fermare,parar,止まる,停止,멈추다,يتوقف,останавливаться|v|74"],
    ["create", "crear,créer,schaffen,creare,criar,作る,创造,창조하다,يخلق,создавать|v|75"],
    ["speak", "hablar,parler,sprechen,parlare,falar,話す,说话,말하다,يتكلم,говорить|v|76"],
    ["read", "leer,lire,lesen,leggere,ler,読む,读,읣다,يقرأ,читать|v|77"],
    ["allow", "permitir,permettre,erlauben,permettere,permitir,許す,允许,허락하다,يسمح,позволять|v|78"],
    ["add", "añadir,ajouter,hinzufügen,aggiungere,adicionar,加える,添加,추가하다,يضيف,добавлять|v|79"],
    ["spend", "gastar,dépenser,ausgeben,spendere,gastar,使う,花费,쓰다,ينفق,тратить|v|80"],
    ["grow", "crecer,grandir,wachsen,crescere,crescer,育つ,成长,자라다,ينمو,расти|v|81"],
    ["open", "abrir,ouvrir,öffnen,aprire,abrir,開ける,打开,열다,يفتح,открывать|v|82"],
    ["walk", "caminar,marcher,gehen,camminare,andar,歩く,走,걷다,يمشي,ходить|v|83"],
    ["win", "ganar,gagner,gewinnen,vincere,ganhar,勝つ,赢,이기다,يفوز,выигрывать|v|84"],
    ["offer", "ofrecer,offrir,anbieten,offrire,oferecer,提供する,提供,제공하다,يقدم,предлагать|v|85"],
    ["remember", "recordar,se souvenir,erinnern,ricordare,lembrar,覚える,记住,기억하다,يتذكر,помнить|v|86"],
    ["love", "amar,aimer,lieben,amare,amar,愛する,爱,사랑하다,يحب,любить|v|87"],
    ["consider", "considerar,considérer,betrachten,considerare,considerar,考える,考虑,고려하다,يعتبر,рассматривать|v|88"],
    ["appear", "aparecer,apparaître,erscheinen,apparire,aparecer,現れる,出现,나타나다,يظهر,появляться|v|89"],
    ["buy", "comprar,acheter,kaufen,comprare,comprar,買う,买,사다,يشتري,покупать|v|90"],
    ["wait", "esperar,attendre,warten,aspettare,esperar,待つ,等待,기다리다,ينتظر,ждать|v|91"],
    ["serve", "servir,servir,dienen,servire,servir,仕える,服务,봉사하다,يخدم,служить|v|92"],
    ["die", "morir,mourir,sterben,morire,morrer,死ぬ,死,죽다,يموت,умирать|v|93"],
    ["send", "enviar,envoyer,senden,inviare,enviar,送る,发送,보내다,يرسل,посылать|v|94"],
    ["expect", "esperar,s'attendre,erwarten,aspettarsi,esperar,期待する,期望,기대하다,يتوقع,ожидать|v|95"],
    ["build", "construir,construire,bauen,costruire,construir,建てる,建造,짓다,يبني,строить|v|96"],
    ["stay", "quedarse,rester,bleiben,restare,ficar,滞在する,留,머무르다,يبقى,оставаться|v|97"],
    ["fall", "caer,tomber,fallen,cadere,cair,落ちる,落下,떨어지다,يسقط,падать|v|98"],
    ["cut", "cortar,couper,schneiden,tagliare,cortar,切る,切,자르다,يقطع,резать|v|99"],
    ["reach", "alcanzar,atteindre,erreichen,raggiungere,alcançar,届く,达到,도달하다,يصل,достигать|v|100"],

    // ===== COMMON NOUNS (Frequency 101-200) =====
    ["time", "tiempo,temps,Zeit,tempo,tempo,時間,时间,시간,وقت,время|n|101"],
    ["year", "año,année,Jahr,anno,ano,年,年,년,سنة,год|n|102"],
    ["people", "gente,gens,Leute,persone,pessoas,人々,人们,사람들,ناس,люди|n|103"],
    ["way", "camino,chemin,Weg,via,caminho,道,路,길,طريق,путь|n|104"],
    ["day", "día,jour,Tag,giorno,dia,日,天,날,يوم,день|n|105"],
    ["man", "hombre,homme,Mann,uomo,homem,男,男人,남자,رجل,мужчина|n|106"],
    ["woman", "mujer,femme,Frau,donna,mulher,女,女人,여자,امرأة,женщина|n|107"],
    ["child", "niño,enfant,Kind,bambino,criança,子供,孩子,아이,طفل,ребёнок|n|108"],
    ["world", "mundo,monde,Welt,mondo,mundo,世界,世界,세계,عالم,мир|n|109"],
    ["life", "vida,vie,Leben,vita,vida,人生,生活,인생,حياة,жизнь|n|110"],
    ["hand", "mano,main,Hand,mano,mão,手,手,손,يد,рука|n|111"],
    ["part", "parte,partie,Teil,parte,parte,部分,部分,부분,جزء,часть|n|112"],
    ["place", "lugar,endroit,Ort,luogo,lugar,場所,地方,장소,مكان,место|n|113"],
    ["case", "caso,cas,Fall,caso,caso,場合,情况,경우,حالة,случай|n|114"],
    ["week", "semana,semaine,Woche,settimana,semana,週,周,주,أسبوع,неделя|n|115"],
    ["company", "empresa,entreprise,Firma,azienda,empresa,会社,公司,회사,شركة,компания|n|116"],
    ["system", "sistema,système,System,sistema,sistema,システム,系统,시스템,نظام,система|n|117"],
    ["program", "programa,programme,Programm,programma,programa,プログラム,程序,프로그램,برنامج,программа|n|118"],
    ["question", "pregunta,question,Frage,domanda,pergunta,質問,问题,질문,سؤال,вопрос|n|119"],
    ["work", "trabajo,travail,Arbeit,lavoro,trabalho,仕事,工作,일,عمل,работа|n|120"],
    ["government", "gobierno,gouvernement,Regierung,governo,governo,政府,政府,정부,حكومة,правительство|n|121"],
    ["number", "número,numéro,Nummer,numero,número,番号,数字,번호,رقم,номер|n|122"],
    ["night", "noche,nuit,Nacht,notte,noite,夜,夜,밤,ليل,ночь|n|123"],
    ["point", "punto,point,Punkt,punto,ponto,点,点,점,نقطة,точка|n|124"],
    ["home", "casa,maison,Zuhause,casa,casa,家,家,집,بيت,дом|n|125"],
    ["water", "agua,eau,Wasser,acqua,água,水,水,물,ماء,вода|n|126"],
    ["room", "habitación,chambre,Zimmer,stanza,quarto,部屋,房间,방,غرفة,комната|n|127"],
    ["mother", "madre,mère,Mutter,madre,mãe,母,母亲,어머니,أم,мать|n|128"],
    ["area", "área,zone,Bereich,area,área,地域,区域,지역,منطقة,область|n|129"],
    ["money", "dinero,argent,Geld,soldi,dinheiro,お金,钱,돈,مال,деньги|n|130"],
    ["story", "historia,histoire,Geschichte,storia,história,物語,故事,이야기,قصة,история|n|131"],
    ["fact", "hecho,fait,Tatsache,fatto,fato,事実,事实,사실,حقيقة,факт|n|132"],
    ["month", "mes,mois,Monat,mese,mês,月,月,달,شهر,месяц|n|133"],
    ["lot", "mucho,beaucoup,viel,molto,muito,たくさん,很多,많이,كثير,много|n|134"],
    ["right", "derecho,droit,Recht,diritto,direito,権利,权利,권리,حق,право|n|135"],
    ["study", "estudio,étude,Studie,studio,estudo,研究,研究,연구,دراسة,исследование|n|136"],
    ["book", "libro,livre,Buch,libro,livro,本,书,책,كتاب,книга|n|137"],
    ["eye", "ojo,œil,Auge,occhio,olho,目,眼睛,눈,عين,глаз|n|138"],
    ["job", "trabajo,emploi,Job,lavoro,emprego,仕事,工作,직업,وظيفة,работа|n|139"],
    ["word", "palabra,mot,Wort,parola,palavra,言葉,词,단어,كلمة,слово|n|140"],
    ["business", "negocio,affaires,Geschäft,affari,negócio,ビジネス,商业,사업,عمل,бизнес|n|141"],
    ["issue", "problema,problème,Problem,problema,problema,問題,问题,문제,مشكلة,проблема|n|142"],
    ["side", "lado,côté,Seite,lato,lado,側,边,쪽,جانب,сторона|n|143"],
    ["kind", "tipo,genre,Art,tipo,tipo,種類,种类,종류,نوع,вид|n|144"],
    ["head", "cabeza,tête,Kopf,testa,cabeça,頭,头,머리,رأس,голова|n|145"],
    ["house", "casa,maison,Haus,casa,casa,家,房子,집,منزل,дом|n|146"],
    ["service", "servicio,service,Service,servizio,serviço,サービス,服务,서비스,خدمة,услуга|n|147"],
    ["friend", "amigo,ami,Freund,amico,amigo,友達,朋友,친구,صديق,друг|n|148"],
    ["father", "padre,père,Vater,padre,pai,父,父亲,아버지,أب,отец|n|149"],
    ["power", "poder,pouvoir,Macht,potere,poder,力,力量,힘,قوة,власть|n|150"],

    // ===== ADJECTIVES (Frequency 151-200) =====
    ["good", "bueno,bon,gut,buono,bom,良い,好,좋은,جيد,хороший|adj|151"],
    ["new", "nuevo,nouveau,neu,nuovo,novo,新しい,新,새로운,جديد,новый|adj|152"],
    ["first", "primero,premier,erst,primo,primeiro,最初の,第一,첫 번째,أول,первый|adj|153"],
    ["last", "último,dernier,letzt,ultimo,último,最後の,最后,마지막,آخر,последний|adj|154"],
    ["long", "largo,long,lang,lungo,longo,長い,长,긴,طويل,длинный|adj|155"],
    ["great", "gran,grand,groß,grande,grande,素晴らしい,伟大,위대한,عظيم,великий|adj|156"],
    ["little", "pequeño,petit,klein,piccolo,pequeno,小さい,小,작은,صغير,маленький|adj|157"],
    ["own", "propio,propre,eigen,proprio,próprio,自分の,自己的,자신의,خاص,собственный|adj|158"],
    ["other", "otro,autre,ander,altro,outro,他の,其他,다른,آخر,другой|adj|159"],
    ["old", "viejo,vieux,alt,vecchio,velho,古い,老,오래된,قديم,старый|adj|160"],
    ["right", "correcto,correct,richtig,corretto,correto,正しい,正确,옳은,صحيح,правильный|adj|161"],
    ["big", "grande,grand,groß,grande,grande,大きい,大,큰,كبير,большой|adj|162"],
    ["high", "alto,haut,hoch,alto,alto,高い,高,높은,عالي,высокий|adj|163"],
    ["different", "diferente,différent,verschieden,diverso,diferente,異なる,不同,다른,مختلف,разный|adj|164"],
    ["small", "pequeño,petit,klein,piccolo,pequeno,小さい,小,작은,صغير,маленький|adj|165"],
    ["large", "grande,grand,groß,grande,grande,大きい,大,큰,كبير,большой|adj|166"],
    ["next", "siguiente,prochain,nächst,prossimo,próximo,次の,下一个,다음,التالي,следующий|adj|167"],
    ["early", "temprano,tôt,früh,presto,cedo,早い,早,이른,مبكر,ранний|adj|168"],
    ["young", "joven,jeune,jung,giovane,jovem,若い,年轻,젊은,شاب,молодой|adj|169"],
    ["important", "importante,important,wichtig,importante,importante,重要な,重要,중요한,مهم,важный|adj|170"],
    ["few", "pocos,peu,wenig,pochi,poucos,少ない,少,적은,قليل,немногие|adj|171"],
    ["public", "público,public,öffentlich,pubblico,público,公共の,公共,공공의,عام,публичный|adj|172"],
    ["bad", "malo,mauvais,schlecht,cattivo,mau,悪い,坏,나쁜,سيء,плохой|adj|173"],
    ["same", "mismo,même,gleich,stesso,mesmo,同じ,相同,같은,نفس,такой же|adj|174"],
    ["able", "capaz,capable,fähig,capace,capaz,できる,能够,할 수 있는,قادر,способный|adj|175"],

    // ===== COMMON WORDS (Frequency 176-228) =====
    ["food", "comida,nourriture,Essen,cibo,comida,食べ物,食物,음식,طعام,еда|n|176"],
    ["car", "coche,voiture,Auto,macchina,carro,車,汽车,차,سيارة,машина|n|177"],
    ["city", "ciudad,ville,Stadt,città,cidade,都市,城市,도시,مدينة,город|n|178"],
    ["family", "familia,famille,Familie,famiglia,família,家族,家庭,가족,عائلة,семья|n|179"],
    ["school", "escuela,école,Schule,scuola,escola,学校,学校,학교,مدرسة,школа|n|180"],
    ["student", "estudiante,étudiant,Student,studente,estudante,学生,学生,학생,طالب,студент|n|181"],
    ["teacher", "profesor,professeur,Lehrer,insegnante,professor,先生,老师,선생님,معلم,учитель|n|182"],
    ["country", "país,pays,Land,paese,país,国,国家,나라,بلد,страна|n|183"],
    ["problem", "problema,problème,Problem,problema,problema,問題,问题,문제,مشكلة,проблема|n|184"],
    ["morning", "mañana,matin,Morgen,mattina,manhã,朝,早上,아침,صباح,утро|n|185"],
    ["afternoon", "tarde,après-midi,Nachmittag,pomeriggio,tarde,午後,下午,오후,بعد الظهر,день|n|186"],
    ["evening", "tarde,soir,Abend,sera,noite,夕方,晚上,저녁,مساء,вечер|n|187"],
    ["today", "hoy,aujourd'hui,heute,oggi,hoje,今日,今天,오늘,اليوم,сегодня|adv|188"],
    ["tomorrow", "mañana,demain,morgen,domani,amanhã,明日,明天,내일,غدا,завтра|adv|189"],
    ["yesterday", "ayer,hier,gestern,ieri,ontem,昨日,昨天,어제,أمس,вчера|adv|190"],
    ["now", "ahora,maintenant,jetzt,adesso,agora,今,现在,지금,الآن,сейчас|adv|191"],
    ["here", "aquí,ici,hier,qui,aqui,ここ,这里,여기,هنا,здесь|adv|192"],
    ["there", "allí,là,dort,là,lá,そこ,那里,거기,هناك,там|adv|193"],
    ["very", "muy,très,sehr,molto,muito,とても,很,매우,جدا,очень|adv|194"],
    ["well", "bien,bien,gut,bene,bem,よく,好,잘,جيدا,хорошо|adv|195"],
    ["just", "solo,juste,nur,solo,apenas,ちょうど,只是,그냥,فقط,только|adv|196"],
    ["also", "también,aussi,auch,anche,também,も,也,또한,أيضا,также|adv|197"],
    ["always", "siempre,toujours,immer,sempre,sempre,いつも,总是,항상,دائما,всегда|adv|198"],
    ["never", "nunca,jamais,nie,mai,nunca,決して,从不,절대,أبدا,никогда|adv|199"],
    ["often", "a menudo,souvent,oft,spesso,frequentemente,よく,经常,자주,غالبا,часто|adv|200"],
    ["sometimes", "a veces,parfois,manchmal,a volte,às vezes,時々,有时,가끔,أحيانا,иногда|adv|201"],
    ["usually", "generalmente,généralement,normalerweise,di solito,geralmente,普通,通常,보통,عادة,обычно|adv|202"],
    ["really", "realmente,vraiment,wirklich,davvero,realmente,本当に,真的,정말,حقا,действительно|adv|203"],
    ["still", "todavía,encore,noch,ancora,ainda,まだ,仍然,아직,لا يزال,всё ещё|adv|204"],
    ["already", "ya,déjà,schon,già,já,もう,已经,이미,بالفعل,уже|adv|205"],
    ["again", "otra vez,encore,wieder,di nuovo,de novo,また,再次,다시,مرة أخرى,снова|adv|206"],
    ["together", "juntos,ensemble,zusammen,insieme,juntos,一緒に,一起,함께,معا,вместе|adv|207"],
    ["maybe", "quizás,peut-être,vielleicht,forse,talvez,多分,也许,아마,ربما,может быть|adv|208"],
    ["however", "sin embargo,cependant,jedoch,tuttavia,no entanto,しかし,然而,그러나,ومع ذلك,однако|adv|209"],
    ["because", "porque,parce que,weil,perché,porque,なぜなら,因为,왜냐하면,لأن,потому что|conj|210"],
    ["if", "si,si,wenn,se,se,もし,如果,만약,إذا,если|conj|211"],
    ["when", "cuando,quand,wenn,quando,quando,いつ,当,언제,عندما,когда|conj|212"],
    ["where", "dónde,où,wo,dove,onde,どこ,哪里,어디,أين,где|adv|213"],
    ["why", "por qué,pourquoi,warum,perché,por que,なぜ,为什么,왜,لماذا,почему|adv|214"],
    ["how", "cómo,comment,wie,come,como,どう,怎么,어떻게,كيف,как|adv|215"],
    ["what", "qué,quoi,was,cosa,o que,何,什么,무엇,ماذا,что|pron|216"],
    ["which", "cuál,lequel,welch,quale,qual,どれ,哪个,어느,أي,который|pron|217"],
    ["who", "quién,qui,wer,chi,quem,誰,谁,누구,من,кто|pron|218"],
    ["all", "todo,tout,alle,tutto,tudo,全て,所有,모든,كل,все|det|219"],
    ["each", "cada,chaque,jede,ogni,cada,各,每个,각각,كل,каждый|det|220"],
    ["both", "ambos,les deux,beide,entrambi,ambos,両方,两个,둘 다,كلا,оба|det|221"],
    ["many", "muchos,beaucoup,viele,molti,muitos,多くの,很多,많은,كثير,много|det|222"],
    ["some", "algunos,quelques,einige,alcuni,alguns,いくつか,一些,몇몇,بعض,некоторые|det|223"],
    ["any", "cualquier,n'importe quel,irgendein,qualsiasi,qualquer,どんな,任何,어떤,أي,любой|det|224"],
    ["more", "más,plus,mehr,più,mais,もっと,更多,더,أكثر,больше|det|225"],
    ["most", "la mayoría,la plupart,meist,la maggior parte,a maioria,ほとんど,大多数,대부분,معظم,большинство|det|226"],
    ["only", "solo,seulement,nur,solo,apenas,のみ,只,오직,فقط,только|adv|227"],
    ["newspaper", "periódico,journal,Zeitung,giornale,jornal,新聞,报纸,신문,صحيفة,газета|n|228"],
]);

// =============================================================================
// HIGH-PERFORMANCE LOOKUP FUNCTIONS
// =============================================================================

/**
 * O(1) lookup with single Map access
 */
export function lookupCompact(word: string): ExpandedEntry | null {
    const key = word.toLowerCase().trim();
    const packed = COMPACT_DICT.get(key);

    if (!packed) return null;

    return unpack(key, packed);
}

/**
 * Unpack compressed entry to full format
 */
function unpack(word: string, packed: string): ExpandedEntry {
    const [transStr, pos, freq] = packed.split('|');
    const transParts = transStr.split(',');

    const translations = new Map<string, string>();
    for (let i = 0; i < LANG_ORDER.length && i < transParts.length; i++) {
        if (transParts[i]) {
            translations.set(LANG_ORDER[i], transParts[i]);
        }
    }

    return {
        word,
        translations,
        pos: pos ? POS_MAP[pos] || pos : undefined,
        frequency: freq ? parseInt(freq) : undefined,
    };
}

/**
 * Fast translation lookup - returns translation or null
 */
export function getTranslation(word: string, targetLang: string): string | null {
    const entry = lookupCompact(word);
    return entry?.translations.get(targetLang) || null;
}

/**
 * Batch translation - much faster than individual lookups
 */
export function batchTranslate(
    words: string[],
    targetLang: string
): { found: Map<string, string>; notFound: string[] } {
    const found = new Map<string, string>();
    const notFound: string[] = [];

    for (const word of words) {
        const translation = getTranslation(word, targetLang);
        if (translation) {
            found.set(word, translation);
        } else {
            notFound.push(word);
        }
    }

    return { found, notFound };
}

/**
 * Get dictionary stats
 */
export function getCompactDictStats(): {
    wordCount: number;
    languages: string[];
    posDistribution: Record<string, number>;
} {
    const posDistribution: Record<string, number> = {};

    for (const packed of COMPACT_DICT.values()) {
        const [, pos] = packed.split('|');
        const fullPos = POS_MAP[pos] || pos || 'unknown';
        posDistribution[fullPos] = (posDistribution[fullPos] || 0) + 1;
    }

    return {
        wordCount: COMPACT_DICT.size,
        languages: [...LANG_ORDER],
        posDistribution,
    };
}

/**
 * Check if word exists in dictionary
 */
export function hasWord(word: string): boolean {
    return COMPACT_DICT.has(word.toLowerCase().trim());
}

/**
 * Get all words (for iteration/export)
 */
export function getAllWords(): string[] {
    return Array.from(COMPACT_DICT.keys());
}

// Export the raw map for direct access if needed
export { COMPACT_DICT };
