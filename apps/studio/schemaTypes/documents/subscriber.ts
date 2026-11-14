import { Mail } from "lucide-react";
import { defineField, defineType } from "sanity";

export const subscriber = defineType({
  name: "subscriber",
  type: "document",
  title: "Subscriber",
  icon: Mail,
  fields: [
    defineField({
      name: "email",
      type: "string",
      title: "Email Address",
      description: "The subscriber's email address",
      validation: (Rule) =>
        Rule.required()
          .email()
          .error("A valid email address is required"),
      readOnly: true,
    }),
    defineField({
      name: "subscribedAt",
      type: "datetime",
      title: "Subscribed At",
      description: "Timestamp when the user subscribed",
      readOnly: true,
      initialValue: () => new Date().toISOString(),
    }),
    defineField({
      name: "source",
      type: "string",
      title: "Source",
      description: "Origin or block where the subscription occurred",
      initialValue: "website",
      readOnly: true,
    }),
    defineField({
      name: "status",
      type: "string",
      title: "Status",
      options: {
        list: [
          { title: "Active", value: "active" },
          { title: "Unsubscribed", value: "unsubscribed" },
        ],
        layout: "radio",
      },
      initialValue: "active",
    }),
  ],
  preview: {
    select: {
      title: "email",
      subtitle: "subscribedAt",
    },
    prepare: ({ title, subtitle }) => {
      const date = subtitle ? new Date(subtitle).toLocaleDateString() : "";
      return {
        title: title || "No email",
        subtitle: date ? `Subscribed: ${date}` : "Pending",
      };
    },
  },
});

