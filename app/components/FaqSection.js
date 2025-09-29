"use client";

import { useState } from 'react';

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      question: "What is the RERA registration number for The ARC project?",
      answer: "The ARC project is registered under RERA with registration number P02400004XXX. All necessary approvals and clearances have been obtained from relevant authorities."
    },
    {
      question: "What are the available apartment configurations and sizes?",
      answer: "The ARC offers 2 BHK (1210 sq.ft), 2.5 BHK (1450 sq.ft), 3 BHK (1850 sq.ft), and 3 BHK Premium (2360 sq.ft) apartments. All units are designed with modern layouts and premium finishes."
    },
    {
      question: "What is the expected possession date?",
      answer: "The project is currently under construction with an expected possession date of December 2025. Construction is progressing as per schedule with regular updates provided to customers."
    },
    {
      question: "What payment plans are available?",
      answer: "We offer flexible payment plans including construction-linked payment plans, down payment schemes, and bank loan assistance. Our sales team can customize payment options based on your financial requirements."
    },
    {
      question: "What amenities are included in the project?",
      answer: "The ARC features world-class amenities including a premium clubhouse, swimming pool, fully equipped gym, children's play area, landscaped gardens, 24/7 security, power backup, and covered parking for all residents."
    },
    {
      question: "How is the connectivity and location advantage?",
      answer: "The project is strategically located in Dundigal with excellent connectivity - 5 minutes to Outer Ring Road, 15 minutes to Financial District, 20 minutes to Gachibowli, and 30 minutes to Hyderabad Airport."
    },
    {
      question: "Are there any additional charges apart from the base price?",
      answer: "The quoted prices are all-inclusive covering basic amenities. Additional charges may apply for premium upgrades, car parking (if not included), and statutory charges like registration and stamp duty."
    },
    {
      question: "What is the maintenance structure?",
      answer: "A professional facility management company will handle maintenance. Monthly maintenance charges will be approximately ₹2-3 per sq.ft covering common area maintenance, security, power backup, and amenity upkeep."
    },
    {
      question: "Is home loan assistance available?",
      answer: "Yes, we have tie-ups with leading banks and financial institutions. Our relationship managers assist with documentation, application processing, and securing competitive interest rates for home loans."
    },
    {
      question: "Can I visit the site and see the sample flat?",
      answer: "Absolutely! Site visits are available daily from 9 AM to 6 PM. Sample flats and the sales office are open for viewing. Please contact our sales team to schedule your visit and arrange transportation if needed."
    }
  ];

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4" style={{color: '#293658'}}>
            Frequently Asked Questions
          </h2>
          <div className="w-24 h-px bg-orange-400 mx-auto mb-6"></div>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Find answers to common questions about The ARC project, pricing, amenities, and more.
          </p>
        </div>

        {/* FAQ Items */}
        <div className="max-w-4xl mx-auto">
          {faqs.map((faq, index) => (
            <div 
              key={index} 
              className="mb-4 bg-white/50 overflow-hidden border border-gray-100  transition-all duration-300"
            >
              {/* Question Button */}
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-gray-100 transition-colors duration-200 focus:outline-none   "
              >
                <span 
                  className="text-lg font-semibold pr-4"
        
                >
                  {faq.question}
                </span>
                
                {/* Animated Icon */}
                <div className={`flex-shrink-0 w-6 h-6 transition-transform duration-300 ${openIndex === index ? 'rotate-180' : 'rotate-0'}`}>
                  <svg 
                    className="w-6 h-6 text-orange-400" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Answer Content with Smooth Animation */}
              <div 
                className={`overflow-hidden transition-all duration-500 ease-in-out ${
                  openIndex === index 
                    ? 'max-h-96 opacity-100' 
                    : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-6 pb-5">
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-gray-700 leading-relaxed mt-3">
                      {faq.answer}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}