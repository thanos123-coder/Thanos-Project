/* Sample content for the design preview. Everything here describes a fictional student.
   University facts (rounds, deadlines, admit rates) are illustrative and approximate.
   When the UI is wired to the agents, this file is replaced by real API responses. */

window.UPCHANCE = {
  student: { first: 'Sofia', last: 'Marin', initials: 'SM', curriculum: 'IB Diploma', predicted: 41, subjects: 38, core: 3 },

  subjects: [
    { name: 'Math: Analysis and Approaches', group: 'Group 5', level: 'HL', grade: 7 },
    { name: 'Physics', group: 'Group 4', level: 'HL', grade: 6 },
    { name: 'Economics', group: 'Group 3', level: 'HL', grade: 7 },
    { name: 'English A: Language and Literature', group: 'Group 1', level: 'SL', grade: 6 },
    { name: 'Spanish B', group: 'Group 2', level: 'SL', grade: 6 },
    { name: 'Chemistry', group: 'Group 6 (science)', level: 'SL', grade: 6 }
  ],

  activities: [
    {
      id: 'tideline', type: 'Computer/Technology', icon: 'waves', tone: 'ivy', tags: ['lead', 'stem'],
      role: 'Founder and lead developer', org: 'TideLine (flood-alert text service)',
      desc: "Built a text-alert service that warns 2,400 residents of my grandmother's town when the river rises fast, using open sensor data.",
      grades: [11, 12], hours: 8, weeks: 40, timing: 'All year',
      note: 'Your strongest activity. Keep it first, and mention the 2026 flood season it ran through in your essays.'
    },
    {
      id: 'robotics', type: 'Robotics', icon: 'cpu', tone: 'info', tags: ['lead', 'stem'],
      role: 'Captain', org: 'Northbridge School Robotics',
      desc: 'Lead a 14-person team; redesigned our drivetrain and took us from 22nd to regional finalist. Run weekly CAD sessions for new members.',
      grades: [10, 11, 12], hours: 6, weeks: 30, timing: 'School year'
    },
    {
      id: 'lab', type: 'Research', icon: 'flask-conical', tone: 'violet', tags: ['stem'],
      role: 'Research intern', org: 'Coastal Hydrology Lab, City University',
      desc: 'Cleaned 6 years of tide-gauge data in Python and made the figures for a lab poster on storm-surge timing.',
      grades: [11], hours: 20, weeks: 6, timing: 'Summer',
      note: 'Ask your supervisor whether the poster was presented anywhere. Naming it adds weight.'
    },
    {
      id: 'tutor', type: 'Community Service (Volunteer)', icon: 'heart-handshake', tone: 'reach', tags: ['service'],
      role: 'Volunteer math tutor', org: 'Harbor Learning Center',
      desc: 'Tutor three refugee students in math every Saturday; two passed their national exams in June after failing the mock.',
      grades: [10, 11, 12], hours: 3, weeks: 36, timing: 'School year'
    },
    {
      id: 'mun', type: 'Debate/Speech', icon: 'landmark', tone: 'target', tags: ['lead', 'service'],
      role: 'Head delegate', org: 'School Model United Nations',
      desc: 'Lead a 9-person delegation to 4 conferences a year; won Best Delegate on the UNEP committee for a carbon-border-tax resolution.',
      grades: [9, 10, 11, 12], hours: null, weeks: 25, timing: 'School year',
      note: 'Hours per week are missing. The Common App needs them.'
    },
    {
      id: 'piano', type: 'Music: Instrumental', icon: 'music', tone: 'violet', tags: ['arts'],
      role: 'Pianist', org: 'ABRSM Grade 8, Distinction',
      desc: 'Practice 5 hours a week; accompany the school choir at two concerts a year and play monthly at a local care home.',
      grades: [9, 10, 11, 12], hours: 5, weeks: 50, timing: 'All year'
    },
    {
      id: 'cafe', type: 'Work (Paid)', icon: 'coffee', tone: 'target', tags: ['work'],
      role: 'Weekend barista', org: 'Copper Kettle Café',
      desc: 'Work Sunday shifts to save for university; trained two new staff members on opening and the till.',
      grades: [11, 12], hours: 7, weeks: 40, timing: 'All year'
    }
  ],

  honors: [
    { title: 'National Physics Olympiad, silver medal', level: 'National', grades: [11] },
    { title: 'ABRSM Grade 8 Piano, Distinction', level: 'International', grades: [10] },
    { title: 'Best Delegate, UNEP committee, regional MUN', level: 'Regional', grades: [11] },
    { title: 'School Prize for Economics', level: 'School', grades: [11] }
  ],

  chats: [
    { group: 'Pinned', pinned: true, items: ['Is my college list balanced?', 'Common App essay brainstorm'] },
    { group: 'Today', items: ['Cambridge Natural Sciences: what to expect', 'Stanford REA or MIT EA?', 'Should I send my SAT to UK universities?'] },
    { group: 'Yesterday', items: ['"Why Michigan" essay ideas', 'Scholarships for international students'] },
    { group: 'Previous 7 days', items: ['Follow-up email to my lab supervisor', 'Physics or engineering at UCL?', 'How many CAS hours do I need?', 'UK vs Canada: total cost'] },
    { group: 'September', items: ['Who should write my references?', 'Is a gap year a good idea?', 'Building my first college list'] }
  ],

  /* lo/hi: chance range in percent. admit: published overall admit rate, rounded (null where it varies by course).
     factors: [label, 0-5 (0 = not known yet), note] */
  universities: [
    {
      id: 'cambridge', name: 'University of Cambridge', initials: 'C',
      city: 'Cambridge, UK', program: 'Natural Sciences (Physical)', round: 'UCAS', deadline: 'Oct 15', days: 2,
      lo: 18, hi: 26, cat: 'reach', admit: null, confidence: 'Medium',
      factors: [['Academics', 5, '41 with 7-7-6 at HL meets the usual offer'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 4, 'Real physics beyond the syllabus'], ['Personal statement', 3, 'Draft ready; needs a final read'], ['Interview', 0, 'Happens in December']],
      take: [
        ['good', '<b>Your grades fit.</b> A predicted 41 with 7-7-6 at Higher Level matches the usual offer for Natural Sciences.'],
        ['action', '<b>Your UCAS application is due in 2 days.</b> Your personal statement still needs a final read, and your reference must be attached.'],
        ['action', 'Most applicants are interviewed in December. Start practicing problem-solving out loud in the Interview tab.']
      ]
    },
    {
      id: 'mit', name: 'Massachusetts Institute of Technology', initials: 'MIT',
      city: 'Cambridge, MA, USA', program: 'Physics (Course 8)', round: 'Early Action', deadline: 'Nov 1', days: 19,
      lo: 7, hi: 11, cat: 'reach', admit: 5, confidence: 'Medium',
      factors: [['Academics', 5, 'Top of the range for IB applicants'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 4, 'TideLine is a strong "maker" story'], ['Essays', 0, 'Not reviewed yet'], ['Testing', 4, 'SAT 1530, Math 790']],
      take: [
        ['good', '<b>TideLine is exactly the kind of hands-on making MIT looks for.</b> Use it in the short answer about something you have built.'],
        ['risk', 'Fewer than 1 in 20 applicants are admitted, so strong profiles are often turned down. Plan around that.'],
        ['action', 'MIT requires test scores. Send your SAT; your 790 in Math helps.']
      ]
    },
    {
      id: 'michigan', name: 'University of Michigan', initials: 'M',
      city: 'Ann Arbor, MI, USA', program: 'Physics, College of LSA', round: 'Early Action', deadline: 'Nov 1', days: 19,
      lo: 30, hi: 42, cat: 'target', admit: 16, confidence: 'Medium',
      factors: [['Academics', 5, 'Well above the typical admit'], ['Course rigor', 5, 'Full IB Diploma'], ['Activities', 4, 'Depth plus service'], ['Essays', 0, 'Community essay in progress'], ['Testing', 4, 'SAT 1530']],
      take: [
        ['good', '<b>Your activities show both depth and service,</b> which Michigan\'s essay questions ask about directly.'],
        ['action', 'Use the tutoring story in the community essay (300 words maximum). It\'s 214 words now.'],
        ['risk', 'International applicants are admitted at a lower rate than in-state students.']
      ]
    },
    {
      id: 'stanford', name: 'Stanford University', initials: 'S',
      city: 'Stanford, CA, USA', program: 'Physics (declared later)', round: 'Regular Decision', deadline: 'Jan 5', days: 84,
      lo: 4, hi: 7, cat: 'reach', admit: 4, confidence: 'Low',
      factors: [['Academics', 5, 'Top of the range'], ['Course rigor', 5, 'Full IB Diploma'], ['Activities', 4, 'Range beyond STEM'], ['Essays', 0, 'Short questions not started'], ['Testing', 4, 'SAT 1530']],
      take: [
        ['risk', '<b>Apply in Regular Decision.</b> Stanford\'s Restrictive Early Action would rule out MIT Early Action.'],
        ['good', 'Model UN, tutoring and piano show range outside STEM, which suits Stanford\'s broad first two years.'],
        ['action', 'The short questions are 50 words each. Start early; they take longer than they look.']
      ]
    },
    {
      id: 'imperial', name: 'Imperial College London', initials: 'IC',
      city: 'London, UK', program: 'Physics MSci', round: 'UCAS', deadline: 'Jan 14', days: 93,
      lo: 38, hi: 50, cat: 'target', admit: null, confidence: 'High',
      factors: [['Academics', 4, '41 overall; Physics HL predicted 6'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 5, 'Research internship and Olympiad'], ['Personal statement', 3, 'Shared with your UCAS choices'], ['Admissions test', 0, 'Check the current requirement']],
      take: [
        ['risk', '<b>Typical offers ask for 7 in both HL Math and HL Physics.</b> Your Physics is predicted 6.'],
        ['good', 'Your hydrology internship and Olympiad silver are strong evidence of physics beyond school.'],
        ['action', 'Ask your physics teacher what it would take to move your prediction to 7 before references are written.']
      ]
    },
    {
      id: 'ucl', name: 'University College London', initials: 'UCL',
      city: 'London, UK', program: 'Physics BSc', round: 'UCAS', deadline: 'Jan 14', days: 93,
      lo: 45, hi: 58, cat: 'target', admit: null, confidence: 'Medium',
      factors: [['Academics', 5, 'Inside the typical offer'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 4, 'Clear thread'], ['Personal statement', 3, 'Shared with your UCAS choices'], ['Interview', 0, 'Not usually required']],
      take: [
        ['good', '<b>Your grades sit inside the typical offer range.</b>'],
        ['action', 'UCL reads the personal statement closely. Keep your answer to UCAS question 1 about physics itself, not careers.'],
        ['risk', 'Competition for international places is stronger than the overall numbers suggest.']
      ]
    },
    {
      id: 'warwick', name: 'University of Warwick', initials: 'W',
      city: 'Coventry, UK', program: 'Physics BSc', round: 'UCAS', deadline: 'Jan 14', days: 93,
      lo: 68, hi: 80, cat: 'likely', admit: null, confidence: 'High',
      factors: [['Academics', 5, 'Above the typical offer'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 4, 'Applied physics and data'], ['Personal statement', 3, 'Shared with your UCAS choices'], ['Interview', 0, 'Not usually required']],
      take: [
        ['good', '<b>You exceed the typical IB offer.</b>'],
        ['good', 'A strong match for your interest in applied physics and data.'],
        ['action', 'Look at the Mathematics and Physics joint course too. Your Math HL 7 suits it.']
      ]
    },
    {
      id: 'edinburgh', name: 'University of Edinburgh', initials: 'E',
      city: 'Edinburgh, UK', program: 'Physics MPhys', round: 'UCAS', deadline: 'Jan 14', days: 93,
      lo: 75, hi: 86, cat: 'likely', admit: null, confidence: 'High',
      factors: [['Academics', 5, 'Above the typical offer'], ['Course rigor', 5, 'HL Math and HL Physics'], ['Activities', 4, 'Flood work fits the region'], ['Personal statement', 3, 'Shared with your UCAS choices'], ['Interview', 0, 'Not usually required']],
      take: [
        ['good', '<b>Your grades exceed the typical offer.</b>'],
        ['good', 'Scottish degrees run four years, so you could take geosciences courses alongside physics in your first two years.'],
        ['action', 'Look at the School of GeoSciences course list and name one course in your UCAS answers.']
      ]
    },
    {
      id: 'toronto', name: 'University of Toronto', initials: 'UofT',
      city: 'Toronto, Canada', program: 'Physical and Mathematical Sciences', round: 'OUAC', deadline: 'Jan 15', days: 94,
      lo: 78, hi: 88, cat: 'likely', admit: 43, confidence: 'High',
      factors: [['Academics', 5, 'Well above typical admission averages'], ['Course rigor', 5, 'Full IB Diploma'], ['Activities', 3, 'Not heavily weighted here'], ['Essays', 0, 'No essay for this program'], ['Testing', 0, 'Not required']],
      take: [
        ['good', '<b>IB 41 is well above typical admission averages for this stream.</b>'],
        ['action', 'Rank your college choices carefully. Your college shapes housing and community on the St. George campus.'],
        ['good', 'At your grade level you may be eligible for entrance scholarships. UpChance has added two to your list.']
      ]
    },
    {
      id: 'mcgill', name: 'McGill University', initials: 'McG',
      city: 'Montréal, Canada', program: 'Physics BSc', round: 'Regular', deadline: 'Jan 15', days: 94,
      lo: 72, hi: 84, cat: 'likely', admit: 45, confidence: 'High',
      factors: [['Academics', 5, 'McGill admits mainly on grades'], ['Course rigor', 5, 'Full IB Diploma'], ['Activities', 2, 'Rarely considered'], ['Essays', 0, 'Not required'], ['Testing', 0, 'Not required']],
      take: [
        ['good', '<b>McGill admits mainly on grades, and yours are strong.</b>'],
        ['good', 'Living costs in Montréal are lower than in London or Boston.'],
        ['action', 'Some French helps with life off campus. Your Spanish B is a good start for learning it.']
      ]
    }
  ],

  /* Essay grader: results per check. `target` is the id of a highlighted span in the essay. */
  scans: {
    ai: {
      legend: [['Likely AI-like', 'var(--hl-ai-strong)'], ['Possibly AI-like', 'var(--hl-ai-weak)']],
      issues: [
        { target: 'a1', kind: 'Likely AI-like', text: 'Generic, high-probability phrasing with no detail from your life.', quote: "In today's rapidly evolving world, technology plays a pivotal role…" },
        { target: 'a2', kind: 'Likely AI-like', text: 'A stock lesson that many essays share. The next sentence says it better in your own words.', quote: 'This experience taught me that perseverance and determination…' },
        { target: 'a3', kind: 'Possibly AI-like', text: 'Abstract ending. Readers remember images more than summaries.', quote: 'I realized that I wanted to use my skills to make a meaningful difference…' }
      ]
    },
    grammar: {
      legend: [['Spelling or grammar', 'var(--danger-soft)', 'var(--danger)']],
      issues: [
        { target: 'g1', kind: 'Wrong word', from: 'their', to: 'there' },
        { target: 'g2', kind: 'Wrong word', from: "who's", to: 'whose' },
        { target: 'g3', kind: 'Wrong word', from: "it's", to: 'its' },
        { target: 'g4', kind: 'Missing comma', from: 'little kid I', to: 'little kid, I' },
        { target: 'g5', kind: 'Spelling', from: 'alot', to: 'a lot' }
      ]
    },
    clarity: {
      legend: [['Wordy, passive or cliché', 'var(--data-info-soft)', 'var(--data-info)'], ['Long sentence', 'transparent', 'var(--data-info)']],
      issues: [
        { target: 'c1', kind: 'Wordy', text: '"Due to the fact that" means "because".', from: 'due to the fact that', to: 'because' },
        { target: 'c2', kind: 'Cliché', text: 'Many essays open a paragraph this way. Start with the first thing you took apart instead.' },
        { target: 'c3', kind: 'Passive voice', text: 'Say who did it. "The system sent the first real alert…" is shorter and clearer.' },
        { target: 'c4', kind: 'Long sentence', text: 'This sentence has 50 words. Split it after "November".' }
      ]
    },
    impact: {
      legend: [['Strong, specific moment', 'var(--data-likely-soft)', 'var(--data-likely)'], ['Telling, not showing', 'var(--data-violet-soft)', 'var(--data-violet)']],
      rubric: [['Voice', 4], ['Specificity', 4], ['Reflection', 3], ['Structure', 4], ['Prompt fit', 5]],
      issues: [
        { target: 'k3', kind: 'Strong moment', text: 'The best line in the essay. It shows the failure and the lesson at once.', tone: 'good' },
        { target: 'k2', kind: 'Strong moment', text: 'A concrete, slightly funny detail that sets up the whole problem.', tone: 'good' },
        { target: 't1', kind: 'Telling, not showing', text: 'Cut this. The next sentence already shows responsibility through what you did.' },
        { target: 'a3', kind: 'Weak ending', text: 'End on the sky or the river, not a summary. Your second-to-last sentence is a stronger last line.' }
      ]
    }
  }
};
