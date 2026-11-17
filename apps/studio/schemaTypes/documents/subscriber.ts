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
      // initialValue: () => new Date().toISOString(), //every new subscriber immediately became active
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
          { title: "Pending Verification", value: "pending"},
        ],
        layout: "radio",
      },
      initialValue: "peding",
      readOnly: true,
      validation: (Rule) => Rule.required(),
    }),

    defineField({
      name: "unscubscribedAt",
      type: "datetime",
      title: "Unsubscribed At",
      description: "Timestamp when the user unsubscribed",
      readOnly: true,
    }),

    defineField({
      name: "verificationTokenHash",
      type: "string",
      title: "Verification Token Hash",
      description: "SHA-256 hash of the verification token",
      readOnly: true,
    }),

    defineField({
      name: "verificationExpiresAt",
      type: "datetime",
      title: "Verification Token Expiry",
      description: "Expiration time of the verification token",
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: "email",
      status: "status",
      subscribedAt: "subscribedAt",
    },
    prepare: ({ title, status, subscribedAt }) => {
      const date = subscribedAt ? new Date(subscribedAt).toLocaleDateString() : "";

      const statusLebel = {
        pending: "Pending verification",
        active: "Active",
        unsubscribed: "Unsubscribed",
      }[status as string] || "Unknown State";

      return {
        title: title || "No email",
        subtitle: date ? `${statusLebel} . ${date}` : statusLebel,
      };
    },
  },
});

