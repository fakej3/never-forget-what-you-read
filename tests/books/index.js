// All 15 book definitions + 4 stress books
// Each definition describes how to generate the PDF and what to expect

export const BOOKS = [
  {
    slug:               'tiny-book',
    title:              'The Tiny Book',
    chapterCount:       5,
    pagesPerChapter:    1,   // opening + 0 content pages (7 pages total with cover)
    totalPages:         7,
    headingFormat:      'standard',   // "Chapter 1: Title"
    detectionStrategy:  'patterns',
    description:        '5 chapters in standard "Chapter N: Title" format, 7 pages total',
    chapterTitles: [
      'Chapter 1: Introduction',
      'Chapter 2: The Foundation',
      'Chapter 3: Building Blocks',
      'Chapter 4: Advanced Concepts',
      'Chapter 5: Conclusion',
    ],
  },
  {
    slug:               'normal-book',
    title:              'The Normal Book',
    chapterCount:       20,
    pagesPerChapter:    3,   // 1 chapter page + 2 content pages
    totalPages:         60,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        '20 chapters in standard format, 60 pages',
  },
  {
    slug:               'long-chapter-book',
    title:              'The Long Chapter Book',
    chapterCount:       3,
    pagesPerChapter:    20, // 1 chapter page + 19 content pages
    totalPages:         60,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        '3 chapters each 20+ pages',
  },
  {
    slug:               'many-small-chapters',
    title:              'Many Small Chapters',
    chapterCount:       50,
    pagesPerChapter:    1,
    totalPages:         50,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        '50 chapters, 1 page each',
  },
  {
    slug:               'roman-numeral-book',
    title:              'The Roman Numeral Book',
    chapterCount:       15,
    pagesPerChapter:    2,
    totalPages:         30,
    headingFormat:      'roman',      // "I. Title", "II. Title", etc.
    detectionStrategy:  'patterns',
    description:        '15 chapters with Roman numeral headings',
  },
  {
    slug:               'part-based-book',
    title:              'The Part-Based Book',
    chapterCount:       4,
    pagesPerChapter:    4,
    totalPages:         16,
    headingFormat:      'part',       // "Part One: ...", "Part Two: ..." etc.
    detectionStrategy:  'patterns',
    description:        '4 parts with word-number format',
    chapterTitles: [
      'Part One: The Beginning',
      'Part Two: The Development',
      'Part Three: The Climax',
      'Part Four: The Resolution',
    ],
  },
  {
    slug:               'mixed-heading-book',
    title:              'The Mixed Heading Book',
    chapterCount:       6,
    pagesPerChapter:    3,
    totalPages:         18,
    headingFormat:      'mixed',      // various heading formats
    detectionStrategy:  'patterns',
    description:        'Mix of CHAPTER ONE, Chapter 2, III., Part Four, etc.',
    chapterTitles: [
      'CHAPTER ONE',
      'Chapter 2: Second Movement',
      'III. The Third Way',
      'Part Four: Transformation',
      'LESSON FIVE',
      'Chapter 6: Finale',
    ],
  },
  {
    slug:               'no-headings-book',
    title:              'The No Headings Book',
    chapterCount:       null, // no chapters detected
    pagesPerChapter:    null,
    totalPages:         50,
    headingFormat:      'none',
    detectionStrategy:  'n-page',    // Strategy C
    description:        'No chapter headings, triggers N-page section fallback',
    expectedSectionCount: 5,          // floor(50/20)=2, max(5,2)=5; ceil(50/5)=10 → 5 sections
  },
  {
    slug:               'large-paragraph-book',
    title:              'The Large Paragraph Book',
    chapterCount:       4,
    pagesPerChapter:    5,
    totalPages:         20,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        'Huge paragraphs per page, no double-newlines between them',
  },
  {
    slug:               'bullet-list-book',
    title:              'The Bullet List Book',
    chapterCount:       5,
    pagesPerChapter:    3,
    totalPages:         15,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        'Many numbered lists (list items must not be detected as headings)',
  },
  {
    slug:               'quote-heavy-book',
    title:              'The Quote Heavy Book',
    chapterCount:       6,
    pagesPerChapter:    3,
    totalPages:         18,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        'Many quoted passages',
  },
  {
    slug:               'vocabulary-heavy-book',
    title:              'The Vocabulary Heavy Book',
    chapterCount:       8,
    pagesPerChapter:    3,
    totalPages:         24,
    headingFormat:      'standard',
    detectionStrategy:  'patterns',
    description:        'Dense technical vocabulary',
  },
  {
    slug:               'self-help-book',
    title:              'Think And Grow Rich',
    chapterCount:       13,
    pagesPerChapter:    3,
    totalPages:         39,
    headingFormat:      'self-help',  // CHAPTER on line 1, ONE on line 2, TITLE on line 3
    detectionStrategy:  'patterns',
    description:        'T&GR style — CHAPTER/ONE/THOUGHTS ARE THINGS multi-line headings (Bug 1 fix)',
    chapterTitles: [
      'CHAPTER ONE — THOUGHTS ARE THINGS',
      'CHAPTER TWO — DESIRE',
      'CHAPTER THREE — FAITH',
      'CHAPTER FOUR — AUTO-SUGGESTION',
      'CHAPTER FIVE — SPECIALIZED KNOWLEDGE',
      'CHAPTER SIX — IMAGINATION',
      'CHAPTER SEVEN — ORGANIZED PLANNING',
      'CHAPTER EIGHT — DECISION',
      'CHAPTER NINE — PERSISTENCE',
      'CHAPTER TEN — POWER OF THE MASTERMIND',
      'CHAPTER ELEVEN — THE MYSTERY OF SEX TRANSMUTATION',
      'CHAPTER TWELVE — THE SUBCONSCIOUS MIND',
      'CHAPTER THIRTEEN — THE BRAIN',
    ],
  },
  {
    slug:               'business-book',
    title:              'The Business Book',
    chapterCount:       8,
    pagesPerChapter:    4,
    totalPages:         32,
    headingFormat:      'part',
    detectionStrategy:  'patterns',
    description:        'Part-based structure like business books',
    chapterTitles: [
      'Part 1: Strategy',
      'Part 2: Leadership',
      'Part 3: Operations',
      'Part 4: Finance',
      'Part 5: Marketing',
      'Part 6: Innovation',
      'Part 7: Culture',
      'Part 8: Growth',
    ],
  },
  {
    slug:               'academic-book',
    title:              'The Academic Book',
    chapterCount:       10,
    pagesPerChapter:    3,
    totalPages:         30,
    headingFormat:      'section',    // "Section 1: ..." format
    detectionStrategy:  'patterns',
    description:        'Section N style headings',
  },
];

export const STRESS_BOOKS = [
  {
    slug:        'stress-100',
    title:       'Stress Test 100 Pages',
    totalPages:  100,
    headingFormat: 'none',
    detectionStrategy: 'n-page',
    description: '100 pages, no headings',
  },
  {
    slug:        'stress-250',
    title:       'Stress Test 250 Pages',
    totalPages:  250,
    chapterEvery: 25,             // chapter heading every N pages → 10 chapters
    headingFormat: 'standard',
    detectionStrategy: 'numbered-sequence',
    description: '250 pages, chapters every 25 pages (10 chapters)',
  },
  {
    slug:        'stress-500',
    title:       'Stress Test 500 Pages',
    totalPages:  500,
    chapterEvery: 50,             // 10 chapters
    headingFormat: 'standard',
    detectionStrategy: 'numbered-sequence',
    description: '500 pages, chapters every 50 pages (10 chapters)',
  },
  {
    slug:        'stress-1000',
    title:       'Stress Test 1000 Pages',
    totalPages:  1000,
    headingFormat: 'none',
    detectionStrategy: 'n-page',
    description: '1000 pages, no headings',
  },
];

// Generate chapter titles for books that don't have custom ones
export function makeChapterTitles(book) {
  if (book.chapterTitles) return book.chapterTitles;

  const count = book.chapterCount || 0;
  const titles = [];

  const TOPICS = ['Introduction', 'The Foundation', 'Building Blocks', 'Advanced Concepts', 'Applied Methods', 'Critical Analysis', 'Synthesis', 'Conclusion', 'Extensions', 'Reflections', 'Future Directions', 'Legacy', 'Summary', 'Review', 'Finale'];

  for (let i = 1; i <= count; i++) {
    switch (book.headingFormat) {
      case 'roman': {
        const roman = toRoman(i);
        titles.push(`${roman}. Chapter Title ${i}`);
        break;
      }
      case 'part':
        titles.push(`Part ${i}: ${['Strategy', 'Development', 'Integration', 'Application', 'Mastery', 'Review', 'Synthesis', 'Conclusion', 'Extension', 'Legacy'][i % 10]}`);
        break;
      case 'section':
        titles.push(`Section ${i}`);
        break;
      case 'self-help':
      case 'caps-word-number':
        titles.push(`CHAPTER ${toWordNumber(i).toUpperCase()} — ${['THOUGHTS ARE THINGS', 'DESIRE', 'FAITH', 'AUTO-SUGGESTION', 'SPECIALIZED KNOWLEDGE', 'IMAGINATION', 'ORGANIZED PLANNING', 'DECISION', 'PERSISTENCE', 'POWER', 'MYSTERY', 'SUBCONSCIOUS', 'THE BRAIN'][i - 1] || `CHAPTER ${i}`}`);
        break;
      case 'word-number':
      case 'running-header': {
        const wn = toWordNumber(i);
        const capitalized = wn.charAt(0).toUpperCase() + wn.slice(1);
        titles.push(`Chapter ${capitalized}: ${TOPICS[(i - 1) % TOPICS.length]}`);
        break;
      }
      case 'word-number-parts': {
        const wn = toWordNumber(i);
        const capitalized = wn.charAt(0).toUpperCase() + wn.slice(1);
        titles.push(`Part ${capitalized}: ${TOPICS[(i - 1) % TOPICS.length]}`);
        break;
      }
      case 'bare-arabic':
        titles.push(`${i}. ${TOPICS[(i - 1) % TOPICS.length]}`);
        break;
      default:
        titles.push(`Chapter ${i}: ${TOPICS[(i - 1) % TOPICS.length]}`);
    }
  }
  return titles;
}

function toRoman(n) {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}

const WORD_NUMS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];

export function toWordNumber(n) {
  return WORD_NUMS[n] || String(n);
}

// ── Extended book definitions (81 books) ──────────────────────────────────────

export const EXTENDED_BOOKS = [
  // ── Word numbers (10 books) ─────────────────────────────────────────────────
  { slug: 'word-num-5', title: 'Word Number 5 Chapters', chapterCount: 5, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '5 chapters Chapter One/Two/... format' },
  { slug: 'word-num-10', title: 'Word Number 10 Chapters', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '10 chapters word number format' },
  { slug: 'word-num-20', title: 'Word Number 20 Chapters', chapterCount: 20, pagesPerChapter: 2, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '20 chapters word number format' },
  { slug: 'caps-word-num-5', title: 'Caps Word Number', chapterCount: 5, pagesPerChapter: 2, headingFormat: 'caps-word-number', detectionStrategy: 'patterns', description: 'CHAPTER ONE style self-help' },
  { slug: 'word-num-parts-5', title: 'Part Word Numbers', chapterCount: 5, pagesPerChapter: 3, headingFormat: 'word-number-parts', detectionStrategy: 'numbered-sequence', description: 'Part One/Two/... format', chapterTitles: ['Part One: The Beginning', 'Part Two: The Development', 'Part Three: The Climax', 'Part Four: The Resolution', 'Part Five: The Legacy'] },
  { slug: 'word-num-6', title: 'Word Num 6', chapterCount: 6, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '6 chapters word number' },
  { slug: 'word-num-8', title: 'Word Num 8', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '8 chapters word number' },
  { slug: 'word-num-15', title: 'Word Num 15', chapterCount: 15, pagesPerChapter: 2, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: '15 chapters word number' },
  { slug: 'word-num-bare', title: 'Bare Word Numbers', chapterCount: 7, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: 'Chapter One: Title format, 7 chapters' },
  { slug: 'word-num-mixed-case', title: 'Mixed Case Word Numbers', chapterCount: 5, pagesPerChapter: 3, headingFormat: 'word-number', detectionStrategy: 'numbered-sequence', description: 'Chapter one: title mixed case', chapterTitles: ['Chapter One: Introduction', 'Chapter Two: The Core', 'Chapter Three: Building', 'Chapter Four: Advanced', 'Chapter Five: Conclusion'] },

  // ── Running headers (6 books) ───────────────────────────────────────────────
  { slug: 'running-header-author', title: 'Author Header Book', chapterCount: 8, pagesPerChapter: 4, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: 'Author name running header on every page' },
  { slug: 'running-header-title', title: 'Title Header Book', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: 'Book title running header' },
  { slug: 'running-header-chapter', title: 'Chapter Header Book', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: 'Chapter name running at top' },
  { slug: 'running-header-5', title: 'Running Header 5', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: '5 chapters with running header' },
  { slug: 'running-header-12', title: 'Running Header 12', chapterCount: 12, pagesPerChapter: 3, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: '12 chapters with running header' },
  { slug: 'running-header-20', title: 'Running Header 20', chapterCount: 20, pagesPerChapter: 2, headingFormat: 'running-header', detectionStrategy: 'numbered-sequence', description: '20 chapters with running header' },

  // ── Part + Chapter hierarchy (10 books) ─────────────────────────────────────
  { slug: 'part-chapter-2x3', title: 'Parts and Chapters 2x3', chapterCount: 6, pagesPerChapter: 4, headingFormat: 'part', detectionStrategy: 'patterns', description: '2 parts × 3 chapters = 6 total', chapterTitles: ['Part 1: The Foundation', 'Part 2: The Development', 'Part 3: The Climax', 'Part 4: Resolution', 'Part 5: Legacy', 'Part 6: Epilogue'] },
  { slug: 'part-chapter-3x4', title: 'Parts 3x4', chapterCount: 12, pagesPerChapter: 3, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '3 parts × 4 chapters = 12 total' },
  { slug: 'part-word-arabic', title: 'Parts Word Arabic', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: 'Parts with word numbers', chapterTitles: ['Part One: Opening', 'Part Two: Rising', 'Part Three: Turning', 'Part Four: Falling', 'Part Five: Closing'] },
  { slug: 'part-5', title: 'Part 5 Chapters', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '5 parts standard' },
  { slug: 'part-6', title: 'Part 6 Chapters', chapterCount: 6, pagesPerChapter: 3, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '6 parts standard' },
  { slug: 'part-7', title: 'Part 7 Chapters', chapterCount: 7, pagesPerChapter: 3, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '7 parts standard' },
  { slug: 'part-9', title: 'Part 9 Chapters', chapterCount: 9, pagesPerChapter: 2, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '9 parts standard' },
  { slug: 'part-10', title: 'Part 10 Chapters', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: '10 parts standard' },
  { slug: 'part-roman-5', title: 'Part Roman 5', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: 'Part I/II/III/IV/V format', chapterTitles: ['Part I: The First', 'Part II: The Second', 'Part III: The Third', 'Part IV: The Fourth', 'Part V: The Fifth'] },
  { slug: 'part-roman-8', title: 'Part Roman 8', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'part', detectionStrategy: 'numbered-sequence', description: 'Part I-VIII format', chapterTitles: ['Part I: Opening', 'Part II: Rising', 'Part III: Turning', 'Part IV: Climax', 'Part V: Falling', 'Part VI: Resolution', 'Part VII: Denouement', 'Part VIII: Closure'] },

  // ── Front/back matter (8 books) ─────────────────────────────────────────────
  { slug: 'prologue-epilogue-5', title: 'Prologue Epilogue', chapterCount: 7, pagesPerChapter: 4, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Prologue + 5 chapters + Epilogue', chapterTitles: ['Prologue', 'Chapter 1: Opening', 'Chapter 2: Rising', 'Chapter 3: Climax', 'Chapter 4: Falling', 'Chapter 5: Conclusion', 'Epilogue'] },
  { slug: 'intro-chapters-10', title: 'Intro Appendix 10', chapterCount: 12, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Introduction + 10 chapters + Appendix', chapterTitles: ['Introduction', 'Chapter 1: Foundation', 'Chapter 2: Building', 'Chapter 3: Structure', 'Chapter 4: Analysis', 'Chapter 5: Methods', 'Chapter 6: Results', 'Chapter 7: Discussion', 'Chapter 8: Implications', 'Chapter 9: Future', 'Chapter 10: Summary', 'Appendix'] },
  { slug: 'foreword-preface-8', title: 'Foreword Preface Book', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Foreword + Preface + 8 chapters', chapterTitles: ['Foreword', 'Preface', 'Chapter 1: The Start', 'Chapter 2: Progress', 'Chapter 3: Midpoint', 'Chapter 4: Challenge', 'Chapter 5: Breakthrough', 'Chapter 6: Mastery', 'Chapter 7: Application', 'Chapter 8: Legacy'] },
  { slug: 'preface-5', title: 'Preface 5 Chapters', chapterCount: 6, pagesPerChapter: 4, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Preface + 5 chapters', chapterTitles: ['Preface', 'Chapter 1: One', 'Chapter 2: Two', 'Chapter 3: Three', 'Chapter 4: Four', 'Chapter 5: Five'] },
  { slug: 'conclusion-8', title: 'Conclusion Book', chapterCount: 9, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: '8 chapters + Conclusion', chapterTitles: ['Chapter 1: First', 'Chapter 2: Second', 'Chapter 3: Third', 'Chapter 4: Fourth', 'Chapter 5: Fifth', 'Chapter 6: Sixth', 'Chapter 7: Seventh', 'Chapter 8: Eighth', 'Conclusion'] },
  { slug: 'afterword-6', title: 'Afterword Book', chapterCount: 7, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: '6 chapters + Afterword', chapterTitles: ['Chapter 1: Beginning', 'Chapter 2: Development', 'Chapter 3: Middle', 'Chapter 4: Turn', 'Chapter 5: Resolution', 'Chapter 6: End', 'Afterword'] },
  { slug: 'prologue-8-epilogue', title: 'Prologue 8 Epilogue', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Prologue + 8 chapters + Epilogue', chapterTitles: ['Prologue', 'Chapter 1: First', 'Chapter 2: Second', 'Chapter 3: Third', 'Chapter 4: Fourth', 'Chapter 5: Fifth', 'Chapter 6: Sixth', 'Chapter 7: Seventh', 'Chapter 8: Eighth', 'Epilogue'] },
  { slug: 'full-matter-5', title: 'Full Matter Book', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Foreword + Preface + 5 chapters + Conclusion + Epilogue', chapterTitles: ['Foreword', 'Preface', 'Chapter 1: One', 'Chapter 2: Two', 'Chapter 3: Three', 'Chapter 4: Four', 'Chapter 5: Five', 'Conclusion'] },

  // ── Various chapter counts (20 books) ───────────────────────────────────────
  { slug: 'count-1', title: '1 Chapter Book', chapterCount: 1, pagesPerChapter: 5, headingFormat: 'standard', detectionStrategy: 'patterns', description: 'Single chapter book' },
  { slug: 'count-2', title: '2 Chapter Book', chapterCount: 2, pagesPerChapter: 10, headingFormat: 'standard', detectionStrategy: 'patterns', description: '2 chapters' },
  { slug: 'count-3', title: '3 Chapter Book', chapterCount: 3, pagesPerChapter: 6, headingFormat: 'standard', detectionStrategy: 'patterns', description: '3 chapters' },
  { slug: 'count-4', title: '4 Chapter Book', chapterCount: 4, pagesPerChapter: 5, headingFormat: 'standard', detectionStrategy: 'patterns', description: '4 chapters' },
  { slug: 'count-6', title: '6 Chapter Book', chapterCount: 6, pagesPerChapter: 4, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '6 chapters' },
  { slug: 'count-7', title: '7 Chapter Book', chapterCount: 7, pagesPerChapter: 4, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '7 chapters' },
  { slug: 'count-8', title: '8 Chapter Book', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '8 chapters' },
  { slug: 'count-9', title: '9 Chapter Book', chapterCount: 9, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '9 chapters' },
  { slug: 'count-11', title: '11 Chapter Book', chapterCount: 11, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '11 chapters' },
  { slug: 'count-12', title: '12 Chapter Book', chapterCount: 12, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '12 chapters' },
  { slug: 'count-14', title: '14 Chapter Book', chapterCount: 14, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '14 chapters' },
  { slug: 'count-16', title: '16 Chapter Book', chapterCount: 16, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '16 chapters' },
  { slug: 'count-18', title: '18 Chapter Book', chapterCount: 18, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '18 chapters' },
  { slug: 'count-22', title: '22 Chapter Book', chapterCount: 22, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '22 chapters' },
  { slug: 'count-24', title: '24 Chapter Book', chapterCount: 24, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '24 chapters' },
  { slug: 'count-26', title: '26 Chapter Book', chapterCount: 26, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '26 chapters' },
  { slug: 'count-28', title: '28 Chapter Book', chapterCount: 28, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '28 chapters' },
  { slug: 'count-35', title: '35 Chapter Book', chapterCount: 35, pagesPerChapter: 2, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '35 chapters' },
  { slug: 'count-40', title: '40 Chapter Book', chapterCount: 40, pagesPerChapter: 1, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '40 chapters 1 page each' },
  { slug: 'count-45', title: '45 Chapter Book', chapterCount: 45, pagesPerChapter: 1, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: '45 chapters 1 page each' },

  // ── No-heading variants (10 books) ──────────────────────────────────────────
  { slug: 'no-heading-10', title: 'No Heading 10 Pages', totalPages: 10, headingFormat: 'none', detectionStrategy: 'single-section', description: '10 pages no headings' },
  { slug: 'no-heading-15', title: 'No Heading 15 Pages', totalPages: 15, headingFormat: 'none', detectionStrategy: 'single-section', description: '15 pages no headings' },
  { slug: 'no-heading-20', title: 'No Heading 20 Pages', totalPages: 20, headingFormat: 'none', detectionStrategy: 'n-page', description: '20 pages no headings', expectedSectionCount: 5 },
  { slug: 'no-heading-30', title: 'No Heading 30 Pages', totalPages: 30, headingFormat: 'none', detectionStrategy: 'n-page', description: '30 pages no headings' },
  { slug: 'no-heading-40', title: 'No Heading 40 Pages', totalPages: 40, headingFormat: 'none', detectionStrategy: 'n-page', description: '40 pages no headings' },
  { slug: 'no-heading-60', title: 'No Heading 60 Pages', totalPages: 60, headingFormat: 'none', detectionStrategy: 'n-page', description: '60 pages no headings' },
  { slug: 'no-heading-75', title: 'No Heading 75 Pages', totalPages: 75, headingFormat: 'none', detectionStrategy: 'n-page', description: '75 pages no headings' },
  { slug: 'no-heading-90', title: 'No Heading 90 Pages', totalPages: 90, headingFormat: 'none', detectionStrategy: 'n-page', description: '90 pages no headings' },
  { slug: 'no-heading-120', title: 'No Heading 120 Pages', totalPages: 120, headingFormat: 'none', detectionStrategy: 'n-page', description: '120 pages no headings' },
  { slug: 'no-heading-200', title: 'No Heading 200 Pages', totalPages: 200, headingFormat: 'none', detectionStrategy: 'n-page', description: '200 pages no headings' },

  // ── Special formats (17 books) ───────────────────────────────────────────────
  { slug: 'section-numbered-8', title: 'Section Numbered 8', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'section', detectionStrategy: 'numbered-sequence', description: 'Section 1-8 format' },
  { slug: 'section-numbered-5', title: 'Section Numbered 5', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'section', detectionStrategy: 'numbered-sequence', description: 'Section 1-5 format' },
  { slug: 'section-numbered-12', title: 'Section Numbered 12', chapterCount: 12, pagesPerChapter: 2, headingFormat: 'section', detectionStrategy: 'numbered-sequence', description: 'Section 1-12 format' },
  { slug: 'roman-5', title: 'Roman 5 Chapters', chapterCount: 5, pagesPerChapter: 5, headingFormat: 'roman', detectionStrategy: 'patterns', description: 'Roman numerals I-V' },
  { slug: 'roman-12', title: 'Roman 12 Chapters', chapterCount: 12, pagesPerChapter: 3, headingFormat: 'roman', detectionStrategy: 'patterns', description: 'Roman numerals I-XII' },
  { slug: 'roman-8', title: 'Roman 8 Chapters', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'roman', detectionStrategy: 'patterns', description: 'Roman numerals I-VIII' },
  { slug: 'chapter-colon-6', title: 'Chapter Colon 6', chapterCount: 6, pagesPerChapter: 4, headingFormat: 'standard', detectionStrategy: 'numbered-sequence', description: 'Chapter N: Title format, 6 chapters', chapterTitles: ['Chapter 1: Dawn', 'Chapter 2: Noon', 'Chapter 3: Dusk', 'Chapter 4: Night', 'Chapter 5: Morning', 'Chapter 6: Twilight'] },
  { slug: 'bare-arabic-10', title: 'Bare Arabic 10', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'bare-arabic', detectionStrategy: 'patterns', description: '1. Title format 10 chapters' },
  { slug: 'bare-arabic-5', title: 'Bare Arabic 5', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'bare-arabic', detectionStrategy: 'patterns', description: '1. Title format 5 chapters' },
  { slug: 'bare-arabic-15', title: 'Bare Arabic 15', chapterCount: 15, pagesPerChapter: 2, headingFormat: 'bare-arabic', detectionStrategy: 'patterns', description: '1. Title format 15 chapters' },
  { slug: 'mixed-format-8', title: 'Mixed Format 8', chapterCount: 8, pagesPerChapter: 3, headingFormat: 'mixed', detectionStrategy: 'patterns', description: 'Mix of formats 8 chapters', chapterTitles: ['Chapter 1: First', 'Part 2: Second', 'III. Third', 'Chapter 4: Fourth', 'Part 5: Fifth', 'VI. Sixth', 'Chapter 7: Seventh', 'Chapter 8: Eighth'] },
  { slug: 'caps-heading-5', title: 'Caps Heading 5', chapterCount: 5, pagesPerChapter: 3, headingFormat: 'self-help', detectionStrategy: 'patterns', description: 'ALL-CAPS headings 5 chapters', chapterTitles: ['CHAPTER ONE — INTRODUCTION', 'CHAPTER TWO — THE CORE', 'CHAPTER THREE — THE MIDDLE', 'CHAPTER FOUR — ADVANCED', 'CHAPTER FIVE — CONCLUSION'] },
  { slug: 'caps-heading-10', title: 'Caps Heading 10', chapterCount: 10, pagesPerChapter: 3, headingFormat: 'self-help', detectionStrategy: 'patterns', description: 'ALL-CAPS headings 10 chapters' },
  { slug: 'caps-heading-13', title: 'Caps Heading 13', chapterCount: 13, pagesPerChapter: 3, headingFormat: 'self-help', detectionStrategy: 'patterns', description: 'ALL-CAPS headings 13 chapters' },
  { slug: 'roman-part-5', title: 'Roman Part 5', chapterCount: 5, pagesPerChapter: 4, headingFormat: 'roman', detectionStrategy: 'patterns', description: 'Roman numeral parts I-V' },
  { slug: 'interlude-5', title: 'Interlude Book', chapterCount: 7, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: '5 chapters + 2 interludes', chapterTitles: ['Chapter 1: First', 'Interlude', 'Chapter 2: Second', 'Chapter 3: Third', 'Interlude', 'Chapter 4: Fourth', 'Chapter 5: Fifth'] },
  { slug: 'bibliography-5', title: 'Bibliography Book', chapterCount: 6, pagesPerChapter: 3, headingFormat: 'standard', detectionStrategy: 'patterns', description: '5 chapters + Bibliography', chapterTitles: ['Chapter 1: Research', 'Chapter 2: Methods', 'Chapter 3: Results', 'Chapter 4: Discussion', 'Chapter 5: Conclusion', 'Bibliography'] },
];
