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
        titles.push(`CHAPTER ${toWordNumber(i).toUpperCase()} — ${['THOUGHTS ARE THINGS', 'DESIRE', 'FAITH', 'AUTO-SUGGESTION', 'SPECIALIZED KNOWLEDGE', 'IMAGINATION', 'ORGANIZED PLANNING', 'DECISION', 'PERSISTENCE', 'POWER', 'MYSTERY', 'SUBCONSCIOUS', 'THE BRAIN'][i - 1] || `CHAPTER ${i}`}`);
        break;
      default:
        titles.push(`Chapter ${i}: ${['Introduction', 'The Foundation', 'Building Blocks', 'Advanced Concepts', 'Applied Methods', 'Critical Analysis', 'Synthesis', 'Conclusion', 'Extensions', 'Reflections', 'Future Directions', 'Legacy', 'Summary', 'Review', 'Finale'][i % 15]}`);
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
